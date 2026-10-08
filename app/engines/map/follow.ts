/**
 * Camera intent for a quiz question: where should the camera go so the player can SEE the
 * new target, and — first — does it need to go anywhere at all?
 *
 * Pure maths, no DOM and no Atlas: Atlas#followTarget builds the inputs and animates the
 * result. It is CLAUDE.md's Interaction principle ("the camera moves only when the user could
 * not already see the target") applied to a quiz run, with one addition the quiz needs:
 *
 *   a) target comfortably inside the visible area AND big enough -> null, leave it alone
 *   b) too small to read as a shape       -> zoom IN until it is, even off the world view
 *   c) too big for the view               -> zoom out the MINIMUM needed
 *   d) otherwise, not fully inside        -> slide it just into view, at the same zoom
 *
 * Seeing the question matters more than keeping the overview, so (b) beats staying zoomed out.
 * "Visible" is measured against the map area actually in view — the canvas minus whatever sits
 * on top of it (`Insets`: today the quiz's docked input) — not the raw canvas.
 */
import { wrapX, latToY, lonToX } from './projection';
import { clampZoom, homeZoom, NO_INSETS, type CameraState, type Insets, type Viewport } from './camera';
import { CAPITAL_MIN_SHAPE_WIDTH } from './thresholds';
import type { Feature, PlaceMark, Ring } from './types';

export { NO_INSETS, type Insets };

/**
 * A quiz target as the camera sees it, in unit-square map space. `box` is the country's
 * mainland box (null for a country with no geometry at all — Vatican City — which has only a
 * pin); `focus` is what must be comfortably in view and what gets centred: the box's middle,
 * or a capital's dot in the capitals quiz.
 */
export interface FollowTarget {
  box: { x0: number; x1: number; y0: number; y1: number } | null;
  focus: { x: number; y: number };
  /** Zoom out to fit the whole box. False when only `focus` matters (a capital dot: Russia's
   *  capital is findable without fitting Russia). The minimum-size rule applies either way. */
  fit: boolean;
  /** Floor, in px, for the comfort margin below — for a target that carries a big halo. */
  marginPx: number;
  /** The smallest the country may be on screen — see quizMinTargetPx. */
  minWidthPx: number;
}

/**
 * All chosen to be tuned by looking (see CLAUDE.md's Where this is).
 *
 * How far in from each edge of the visible area a target must sit to count as visible, as a
 * share of that dimension. Merely intersecting the viewport is not enough — a sliver at the
 * edge is not "seen". The frame padding is derived from it so the two can't disagree: a
 * country zoomed out to fit is, by construction, comfortably inside.
 */
export const QUIZ_COMFORT_MARGIN = 0.1;
/** When zooming out to fit, the target may take up this share of the visible area. */
/** The looser test for "already visible, leave the camera alone": the whole box on screen, a
 *  hair from the edge at most. Much smaller than the comfort margin on purpose — a country
 *  you can already see in full must not make the camera twitch. */
export const QUIZ_VISIBLE_MARGIN = 0.02;
export const QUIZ_FRAME_PADDING = 1 - 2 * QUIZ_COMFORT_MARGIN;
/** The smallest a target country may be on screen, in px of WIDTH (the measure the renderer
 *  uses to decide pin vs shape). Below it the camera zooms in until it isn't. About twice
 *  PIN_MAX_WIDTH: a shape you can tell is a shape, not a dot to hunt for. Tuned by playing over
 *  all 197 targets: at 24 px, 63% of questions zoomed and the near-world view was gone; at 12,
 *  38% do and only the ~25 genuine micro-states zoom far. */
export const QUIZ_MIN_TARGET_PX = 12;
/** The capitals quiz draws a ring on the capital, which needs a real outline to sit on
 *  (thresholds.ts's CAPITAL_MIN_SHAPE_WIDTH), so its minimum is the larger of the two. */
export const quizMinTargetPx = (withCapitalRing: boolean, narrow = false): number => {
  const min = narrow ? QUIZ_MIN_TARGET_PX_NARROW : QUIZ_MIN_TARGET_PX;
  return withCapitalRing ? Math.max(min, CAPITAL_MIN_SHAPE_WIDTH) : min;
};

/**
 * A phone-sized viewport (the quiz's visible strip is a fraction of a ~390 px world): 12 px left
 * a third of the questions on the overview with a country too small to read and sent the micro
 * ones 100x+ in. Between the two: a larger minimum, and a ceiling on how close it may go.
 * Tuned by the share of questions that zoom and by how far the micro ones go (follow-all.test.ts).
 */
export const NARROW_VIEWPORT_PX = 520;
export const QUIZ_MIN_TARGET_PX_NARROW = 18;
export const NARROW_MAX_ZOOM_FACTOR = 20;
export const NARROW_NO_SHAPE_ZOOM_FACTOR = 16;
/** Floors on the comfort margin for a target that isn't a plain box. */
export const QUIZ_POINT_MARGIN_PX = 60; // a capital dot: room around it
export const QUIZ_PIN_MARGIN_PX = 48; // a country with no shape: its pin carries a big halo
export const QUIZ_EDGE_MARGIN_PX = 12; // a shape: at least this even in a tiny view
/** At or below this multiple of the home zoom the player is at the overview. Above it, a new
 *  question first returns to the home view (Atlas#followTarget) — for every way of getting to
 *  the next question. */
export const QUIZ_WORLD_VIEW_FACTOR = 1.25;
/** Zoom (x homeZoom) for a country with no geometry, where there is no width to guarantee:
 *  neighbourhood scale, so the pin and its ring sit on a recognisable patch of map. The same
 *  factor flyTo uses for such a feature. */
export const NO_SHAPE_ZOOM_FACTOR = 34;

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
type Box = { x0: number; x1: number; y0: number; y1: number };
const boxCache = new WeakMap<object, Box | null>();

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

export function mainlandBox(feature: Feature): Box | null {
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
  return box;
}

/** A usable map point: finite, and not the unit square's (0, 0) corner — the north-west edge
 *  of Web Mercator, which is what an unset anchor looks like. */
const usable = (x: number, y: number): boolean => Number.isFinite(x) && Number.isFinite(y) && !(x === 0 && y === 0);

/**
 * Where the camera should look for a country that has no usable shape box: its capital mark,
 * else its own anchor, else the point its record's lat/lng names. Null when none exists —
 * the caller then leaves the camera alone. A country whose shape never arrived (a dot-only
 * micro-state, or before geometry loads) has ux/uy of 0, which must never become a target:
 * y = 0 is the north edge of the map.
 */
export function markerPoint(feature: Feature, place: PlaceMark | null): { x: number; y: number } | null {
  if (place && usable(place.ux, place.uy)) return { x: place.ux, y: place.uy };
  if (feature.bbox && usable(feature.ux, feature.uy)) return { x: feature.ux, y: feature.uy };
  const [lat, lon] = feature.country.latlng;
  const x = wrapX(lonToX(lon)), y = latToY(lat);
  return usable(x, y) ? { x, y } : null;
}

/**
 * The quiz camera's target for a country (and, in the capitals quiz, its capital): the shape's
 * mainland box when it has one the zoom limits can make legible, else the marker point at
 * neighbourhood zoom (`box` null). Null when there is nowhere to go.
 */
export function quizFollowTarget(feature: Feature, place: PlaceMark | null, viewport: Viewport): FollowTarget | null {
  const minWidthPx = quizMinTargetPx(Boolean(place), viewport.width < NARROW_VIEWPORT_PX);
  const mainland = feature.halo
    ? { x0: feature.halo.x0, x1: feature.halo.x1, y0: feature.halo.y0, y1: feature.halo.y1 }
    : feature.bbox && (feature.path || feature.fullPath) ? mainlandBox(feature) : null;
  const width = mainland ? mainland.x1 - mainland.x0 : 0;
  const reachable = mainland && width > 0 && width * clampZoom(minWidthPx / width, viewport) >= minWidthPx * 0.999;
  const box = reachable ? mainland : null;
  const centre = box ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : null;
  const focus = (place && markerPoint(feature, place)) || centre || markerPoint(feature, null);
  if (!focus || !usable(focus.x, focus.y)) return null;
  if (place) return { box, focus, fit: false, marginPx: QUIZ_POINT_MARGIN_PX, minWidthPx };
  if (box && centre) return { box, focus: centre, fit: true, marginPx: QUIZ_EDGE_MARGIN_PX, minWidthPx };
  return { box: null, focus, fit: false, marginPx: QUIZ_PIN_MARGIN_PX, minWidthPx };
}

export interface FollowOptions {
  /** The zoom to use for a target with no shape (`box` null). */
  noShapeZoom: number;
  /** Ceiling for zooming IN on a target (never below the camera's own zoom). Omitted = none. */
  maxZoom?: number;
}

/** The follow options for a viewport: neighbourhood zoom for a shapeless country, and on a narrow
 *  (phone) viewport a gentler one plus a ceiling. */
export function quizFollowOptions(viewport: Viewport): FollowOptions {
  const home = homeZoom(viewport);
  return viewport.width < NARROW_VIEWPORT_PX
    ? { noShapeZoom: home * NARROW_NO_SHAPE_ZOOM_FACTOR, maxZoom: home * NARROW_MAX_ZOOM_FACTOR }
    : { noShapeZoom: home * NO_SHAPE_ZOOM_FACTOR };
}

/**
 * The camera to move to, or null to leave it alone. The caller clamps the result
 * (camera.ts's clamp) — that is where the min/max zoom and vertical limits live, so a
 * micro-state cannot drive the camera anywhere the player couldn't zoom to themselves.
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

  // the zoom this target needs: out to fit (c), then in until legible (b)
  let zoom = camera.zoom;
  if (target.box) {
    const w = Math.max(target.box.x1 - target.box.x0, 1e-9), h = Math.max(target.box.y1 - target.box.y0, 1e-9);
    if (target.fit) {
      zoom = Math.min(zoom, (visibleW * QUIZ_FRAME_PADDING) / w, (visibleH * QUIZ_FRAME_PADDING) / h);
    }
    zoom = Math.max(zoom, target.minWidthPx / w);
  } else {
    zoom = Math.max(zoom, options.noShapeZoom);
  }
  if (options.maxZoom !== undefined) zoom = Math.min(zoom, Math.max(options.maxZoom, camera.zoom));
  const rezoomed = Math.abs(zoom - camera.zoom) > camera.zoom * 1e-6;

  // where the target's box (or point) lands on screen, the short way round the antimeridian
  const box = target.box ?? { x0: target.focus.x, x1: target.focus.x, y0: target.focus.y, y1: target.focus.y };
  const shortDx = (x: number) => {
    const d = x - wrapX(camera.x);
    return d - Math.round(d);
  };
  const sx = viewport.width / 2 + shortDx(target.focus.x) * zoom;
  const sy = viewport.height / 2 + (target.focus.y - camera.y) * zoom;
  // a box-fitting target must have the whole box inside; a point target just its focus
  const halfW = target.fit ? ((box.x1 - box.x0) / 2) * zoom : 0;
  const halfH = target.fit ? ((box.y1 - box.y0) / 2) * zoom : 0;

  const vx = Math.max(target.marginPx, QUIZ_VISIBLE_MARGIN * visibleW);
  const vy = Math.max(target.marginPx, QUIZ_VISIBLE_MARGIN * visibleH);
  const insideX = sx - halfW >= left + vx && sx + halfW <= right - vx;
  const insideY = sy - halfH >= top + vy && sy + halfH <= bottom - vy;
  if (!rezoomed && insideX && insideY) return null;

  // (d) not rezoomed: SLIDE, don't re-centre — shift each failing axis by the least that puts
  // the target inside the comfort margin, so the view nudges instead of jumping.
  if (!rezoomed) {
    const mx = Math.max(target.marginPx, QUIZ_COMFORT_MARGIN * visibleW);
    const my = Math.max(target.marginPx, QUIZ_COMFORT_MARGIN * visibleH);
    const slide = (lo: number, hi: number, min: number, max: number, m: number) => {
      if (hi - lo > max - min - 2 * m) return (min + max) / 2 - (lo + hi) / 2; // too big: centre
      return lo < min + m ? min + m - lo : hi > max - m ? max - m - hi : 0;
    };
    const dx = insideX ? 0 : slide(sx - halfW, sx + halfW, left, right, mx);
    const dy = insideY ? 0 : slide(sy - halfH, sy + halfH, top, bottom, my);
    return { x: camera.x - dx / zoom, y: camera.y - dy / zoom, zoom };
  }

  // the zoom changed: centre the focus in the middle of the VISIBLE area, not of the canvas.
  const visibleCx = (left + right) / 2, visibleCy = (top + bottom) / 2;
  const centredX = target.focus.x - (visibleCx - viewport.width / 2) / zoom;
  const centredY = target.focus.y - (visibleCy - viewport.height / 2) / zoom;
  return {
    x: centredX,
    y: centredY,
    zoom
  };
}
