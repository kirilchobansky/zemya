/**
 * Camera intent for a quiz question: where should the camera go so the player can see the
 * new target, and — first — does it need to go anywhere at all?
 *
 * Pure maths, no DOM and no Atlas: Atlas#followTarget builds the inputs and animates the
 * result. This is CLAUDE.md's Interaction principle ("the camera moves only when the user
 * could not already see the target") applied to a quiz run:
 *
 *   a) target already visible  -> null, leave the camera completely alone
 *   b) not visible             -> pan to it at the player's CURRENT zoom
 *   c) doesn't fit at that zoom-> zoom out the MINIMUM needed, never in, never past the
 *                                 world view unless fitting genuinely needs it
 *
 * "Visible" is measured against the map area actually in view — the canvas minus whatever
 * sits on top of it (`Insets`: today the quiz's docked input) — not the raw canvas.
 */
import { wrapX, latToY, lonToX } from './projection';
import type { CameraState, Viewport } from './camera';
import type { Feature, Ring } from './types';

/** Pixels of the canvas covered by something on top of it, per side. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** A target in unit-square map space. A point has x0 === x1 and y0 === y1. */
export interface FollowTarget {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** A capital dot or a pin-drawn micro-state: has no size to judge, only a position. */
  point: boolean;
  /** How far in from the edge of the visible area the target must sit to count as visible. */
  marginPx: number;
}

/**
 * All chosen to be tuned by looking (see CLAUDE.md's Where this is).
 * A country narrower than this on screen is too small to identify by its shape alone.
 */
export const QUIZ_MIN_TARGET_WIDTH_PX = 24;
/** A country must clear the edge of the visible area by this much, or it counts as clipped. */
export const QUIZ_EDGE_MARGIN_PX = 12;
/** A capital dot needs room around it: a "comfortable" margin, not touching an edge. */
export const QUIZ_POINT_MARGIN_PX = 60;
/** A pin-drawn micro-state carries a big halo ring; it needs room for that too. */
export const QUIZ_PIN_MARGIN_PX = 48;
/** When zooming out to fit, the target may take up this share of the visible area. */
export const QUIZ_FRAME_PADDING = 0.8;
/** At or below this multiple of homeZoom the whole world is on screen: nothing is
 *  "off screen" to reveal and no pan can make a small country bigger, so the size test is
 *  waived — the brass highlight/pin is the marker there, and a world that slid sideways on
 *  every small country would throw away the still overview the run starts from. */
export const QUIZ_WORLD_VIEW_FACTOR = 1.25;

export function pointTarget(ux: number, uy: number, marginPx: number): FollowTarget {
  return { x0: ux, x1: ux, y0: uy, y1: uy, point: true, marginPx };
}

/**
 * A country's box for camera purposes: its MAINLAND cluster, not every polygon. The whole
 * feature's bbox drags in remote exclaves (French Guiana makes France span the Atlantic),
 * and framing that would zoom out for a country you identify by its European shape. Kept:
 * the largest polygon plus any polygon at least 2% of its size within three of its own
 * diagonals — so Indonesia keeps Papua, Japan keeps every main island, France drops Guiana.
 * Size is bbox area in degrees, a cheap proxy that is good enough to rank polygons.
 */
const MAINLAND_MIN_SHARE = 0.02;
const MAINLAND_REACH = 3;
const boxCache = new WeakMap<object, Omit<FollowTarget, 'marginPx' | 'point'> | null>();

function ringBox(ring: Ring): [number, number, number, number] {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

export function mainlandBox(feature: Feature): FollowTarget | null {
  // keyed on the polygons array, which attachFullDetail replaces — a stale coarse box is
  // never reused once full geometry arrives
  let box = boxCache.get(feature.polygons);
  if (box === undefined) {
    const boxes = feature.polygons.map(p => ringBox(p[0]));
    if (!boxes.length) {
      box = null;
    } else {
      const area = (b: number[]) => Math.max(1e-6, (b[2] - b[0]) * (b[3] - b[1]));
      const largest = boxes.reduce((a, b) => (area(b) > area(a) ? b : a));
      const cx = (largest[0] + largest[2]) / 2, cy = (largest[1] + largest[3]) / 2;
      const reach = MAINLAND_REACH * Math.hypot(largest[2] - largest[0], largest[3] - largest[1]);
      const kept = boxes.filter(
        b =>
          b === largest ||
          (area(b) >= MAINLAND_MIN_SHARE * area(largest) &&
            Math.hypot((b[0] + b[2]) / 2 - cx, (b[1] + b[3]) / 2 - cy) <= reach)
      );
      const minLon = Math.min(...kept.map(b => b[0])), maxLon = Math.max(...kept.map(b => b[2]));
      const minLat = Math.min(...kept.map(b => b[1])), maxLat = Math.max(...kept.map(b => b[3]));
      box = { x0: lonToX(minLon), x1: lonToX(maxLon), y0: latToY(maxLat), y1: latToY(minLat) };
    }
    boxCache.set(feature.polygons, box);
  }
  return box ? { ...box, point: false, marginPx: QUIZ_EDGE_MARGIN_PX } : null;
}

export interface FollowOptions {
  /** Skip the "big enough to identify" test — see QUIZ_WORLD_VIEW_FACTOR. */
  sizeWaived: boolean;
}

/**
 * The camera to move to, or null to leave it alone. Never zooms in. The caller clamps the
 * result (camera.ts's clamp) — that is where the min/max zoom and vertical limits live, so
 * a tiny country cannot drive the camera anywhere the player couldn't zoom to themselves.
 */
export function cameraForTarget(
  camera: CameraState,
  viewport: Viewport,
  insets: Insets,
  target: FollowTarget,
  options: FollowOptions
): CameraState | null {
  const left = insets.left, right = viewport.width - insets.right;
  const top = insets.top, bottom = viewport.height - insets.bottom;
  const visibleW = Math.max(1, right - left), visibleH = Math.max(1, bottom - top);

  // the target's screen box, taking the short way round the antimeridian like worldToScreen
  const cx = (target.x0 + target.x1) / 2, cy = (target.y0 + target.y1) / 2;
  let dx = cx - wrapX(camera.x);
  dx -= Math.round(dx);
  const sx = viewport.width / 2 + dx * camera.zoom;
  const sy = viewport.height / 2 + (cy - camera.y) * camera.zoom;
  const halfW = ((target.x1 - target.x0) / 2) * camera.zoom;
  const halfH = ((target.y1 - target.y0) / 2) * camera.zoom;

  const m = target.marginPx;
  const inside =
    sx - halfW >= left + m && sx + halfW <= right - m &&
    sy - halfH >= top + m && sy + halfH <= bottom - m;
  const bigEnough = target.point || options.sizeWaived || halfW * 2 >= QUIZ_MIN_TARGET_WIDTH_PX;
  if (inside && bigEnough) return null;

  // (c) zoom out only as far as fitting needs; never in
  let zoom = camera.zoom;
  if (!target.point) {
    const w = Math.max(target.x1 - target.x0, 0.0002), h = Math.max(target.y1 - target.y0, 0.0002);
    zoom = Math.min(zoom, (visibleW * QUIZ_FRAME_PADDING) / w, (visibleH * QUIZ_FRAME_PADDING) / h);
  }

  // (b) put the target in the middle of the VISIBLE area, not of the canvas
  const visibleCx = (left + right) / 2, visibleCy = (top + bottom) / 2;
  return {
    x: cx - (visibleCx - viewport.width / 2) / zoom,
    y: cy - (visibleCy - viewport.height / 2) / zoom,
    zoom
  };
}
