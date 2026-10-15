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
import { wrapX } from "./projection";
import {
  clampZoom,
  homeZoom,
  NO_INSETS,
  type CameraState,
  type Insets,
  type Viewport,
} from "./camera";
import { CAPITAL_MIN_SHAPE_WIDTH } from "./thresholds";
import type { Feature, PlaceMark, Ring } from "./types";

export { NO_INSETS, type Insets };
import { NARROW_VIEWPORT_PX, type FollowTarget } from "./follow-target";
export * from "./follow-target";

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

export const NARROW_MAX_ZOOM_FACTOR = 7;
export const NARROW_NO_SHAPE_ZOOM_FACTOR = 7;
/** Phone: the whole country stays this far (px) inside the visible strip (6% of its shorter
 *  side, clamped). The biggest countries (Russia, Canada, ...) zoom out until they fit with it. */
export const NARROW_EDGE_MARGIN_MIN_PX = 20;
export const NARROW_EDGE_MARGIN_MAX_PX = 32;
export const NARROW_EDGE_MARGIN_SHARE = 0.06;
/** Mid-sized countries are brought up to this width, but by at most this multiple of home zoom. */
export const NARROW_COMFORT_WIDTH_PX = 50;
/** Exponent of that pull: 1 = straight to the comfort width, 0 = none. */
const COMFORT_PULL = 0.5;
export const NARROW_COMFORT_MAX_FACTOR = 4;
/** Desktop: the camera moves little. It never zooms out to fit a country and counts a country as
 *  visible when its focus point is in view; it zooms in only for one too small to read, and never
 *  past this multiple of home zoom (a micro-state is a small patch of map, not a close-up). */
/** Phone: zoom in only this share (log scale) of the way to the legible size. */
export const NARROW_ZOOM_IN_PULL = 0.5;
export const DESKTOP_MAX_ZOOM_FACTOR = 3;
export const DESKTOP_NO_SHAPE_ZOOM_FACTOR = 3;
/** Desktop zooms in only this share (log scale) of the way to the legible size. */
export const DESKTOP_ZOOM_IN_PULL = 0.6;
/** Desktop: the whole country stays this far (px) inside the visible area: 2rem, growing with
 *  the screen (4% of its shorter side) to 3rem. A country that cannot fit with it is zoomed out
 *  the minimum needed. */
export const DESKTOP_EDGE_MARGIN_MIN_PX = 40;
export const DESKTOP_EDGE_MARGIN_MAX_PX = 60;
export const DESKTOP_EDGE_MARGIN_SHARE = 0.05;
/** At or below this multiple of the home zoom the player is at the overview. Above it, a new
 *  question first returns to the home view (Atlas#followTarget) — for every way of getting to
 *  the next question. */
export const QUIZ_WORLD_VIEW_FACTOR = 1.6;
/** Zoom (x homeZoom) for a country with no geometry, where there is no width to guarantee:
 *  neighbourhood scale, so the pin and its ring sit on a recognisable patch of map. The same
 *  factor flyTo uses for such a feature. */
export const NO_SHAPE_ZOOM_FACTOR = 34;

export interface FollowOptions {
  /** The zoom to use for a target with no shape (`box` null). */
  noShapeZoom: number;
  /** Ceiling for zooming IN on a target (never below the camera's own zoom). Omitted = none. */
  maxZoom?: number;
  /** Share of the visible area a zoomed-out-to-fit target may take; default QUIZ_FRAME_PADDING. Above 1 the
   *  biggest countries may overflow the strip a little instead of shrinking to fit it. */
  framePadding?: number;
  /** A target narrower than this (px) is pulled toward it — by no more than `comfortMaxZoom`. */
  comfortWidthPx?: number;
  comfortMaxZoom?: number;
  /** Min and max (px) of the margin the whole box keeps from the visible area's edge. */
  edgeMarginPx?: [number, number];
  /** Share of the visible area's shorter side the margin starts from (clamped to `edgeMarginPx`). */
  edgeMarginShare?: number;
  /** Share (0..1] of the way, in log zoom, to the zoom that makes a too-small target legible.
   *  1 or omitted = all the way; less leaves a small country smaller but the camera calmer. */
  zoomInPull?: number;
}

/** The follow options for a viewport: neighbourhood zoom for a shapeless country, and on a narrow
 *  (phone) viewport a gentler one plus a ceiling. */
export function quizFollowOptions(viewport: Viewport): FollowOptions {
  const home = homeZoom(viewport);
  return viewport.width < NARROW_VIEWPORT_PX
    ? {
        noShapeZoom: home * NARROW_NO_SHAPE_ZOOM_FACTOR,
        maxZoom: home * NARROW_MAX_ZOOM_FACTOR,
        edgeMarginPx: [NARROW_EDGE_MARGIN_MIN_PX, NARROW_EDGE_MARGIN_MAX_PX],
        edgeMarginShare: NARROW_EDGE_MARGIN_SHARE,
        comfortWidthPx: NARROW_COMFORT_WIDTH_PX,
        comfortMaxZoom: home * NARROW_COMFORT_MAX_FACTOR,
        zoomInPull: NARROW_ZOOM_IN_PULL,
      }
    : {
        noShapeZoom: home * DESKTOP_NO_SHAPE_ZOOM_FACTOR,
        maxZoom: home * DESKTOP_MAX_ZOOM_FACTOR,
        edgeMarginPx: [DESKTOP_EDGE_MARGIN_MIN_PX, DESKTOP_EDGE_MARGIN_MAX_PX],
        zoomInPull: DESKTOP_ZOOM_IN_PULL,
      };
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
  options: FollowOptions,
): CameraState | null {
  const left = insets.left,
    right = viewport.width - insets.right;
  const top = insets.top,
    bottom = viewport.height - insets.bottom;
  const visibleW = Math.max(1, right - left),
    visibleH = Math.max(1, bottom - top);

  // the zoom this target needs: out to fit (c), then in until legible (b)
  const edge = options.edgeMarginPx
    ? Math.min(
        options.edgeMarginPx[1],
        Math.max(
          options.edgeMarginPx[0],
          (options.edgeMarginShare ?? DESKTOP_EDGE_MARGIN_SHARE) *
            Math.min(visibleW, visibleH),
        ),
      )
    : 0;
  let zoom = camera.zoom;
  if (target.box) {
    const w = Math.max(target.box.x1 - target.box.x0, 1e-9),
      h = Math.max(target.box.y1 - target.box.y0, 1e-9);
    if (target.fit) {
      const pad = options.framePadding ?? QUIZ_FRAME_PADDING;
      zoom = Math.min(
        zoom,
        (Math.max(1, visibleW - 2 * edge) * (options.edgeMarginPx ? 1 : pad)) /
          w,
        (Math.max(1, visibleH - 2 * edge) * (options.edgeMarginPx ? 1 : pad)) /
          h,
      );
    }
    const legible = target.minWidthPx / w;
    zoom = Math.max(
      zoom,
      options.zoomInPull && legible > zoom
        ? zoom * (legible / zoom) ** options.zoomInPull
        : legible,
    );
    if (options.comfortWidthPx && options.comfortMaxZoom) {
      // a softened pull toward the comfort width: the smaller the country, the more, never all the way
      const px = w * camera.zoom;
      if (px < options.comfortWidthPx) {
        zoom = Math.max(
          zoom,
          Math.min(
            camera.zoom * (options.comfortWidthPx / px) ** COMFORT_PULL,
            options.comfortMaxZoom,
          ),
        );
      }
    }
  } else {
    zoom = Math.max(zoom, options.noShapeZoom);
  }
  if (options.maxZoom !== undefined)
    zoom = Math.min(zoom, Math.max(options.maxZoom, camera.zoom));
  const rezoomed = Math.abs(zoom - camera.zoom) > camera.zoom * 1e-6;

  // where the target's box (or point) lands on screen, the short way round the antimeridian
  const box = target.box ?? {
    x0: target.focus.x,
    x1: target.focus.x,
    y0: target.focus.y,
    y1: target.focus.y,
  };
  const shortDx = (x: number) => {
    const d = x - wrapX(camera.x);
    return d - Math.round(d);
  };
  const sx = viewport.width / 2 + shortDx(target.focus.x) * zoom;
  const sy = viewport.height / 2 + (target.focus.y - camera.y) * zoom;
  // a box-fitting target must have the whole box inside; a point target just its focus
  const halfW = target.fit ? ((box.x1 - box.x0) / 2) * zoom : 0;
  const halfH = target.fit ? ((box.y1 - box.y0) / 2) * zoom : 0;

  const vx = Math.max(target.marginPx, edge || QUIZ_VISIBLE_MARGIN * visibleW);
  const vy = Math.max(target.marginPx, edge || QUIZ_VISIBLE_MARGIN * visibleH);
  const insideX = sx - halfW >= left + vx && sx + halfW <= right - vx;
  const insideY = sy - halfH >= top + vy && sy + halfH <= bottom - vy;
  if (!rezoomed && insideX && insideY) return null;

  // (d) not rezoomed: SLIDE, don't re-centre — shift each failing axis by the least that puts
  // the target inside the comfort margin, so the view nudges instead of jumping.
  if (!rezoomed) {
    const mx = Math.max(
      target.marginPx,
      edge || QUIZ_COMFORT_MARGIN * visibleW,
    );
    const my = Math.max(
      target.marginPx,
      edge || QUIZ_COMFORT_MARGIN * visibleH,
    );
    const slide = (
      lo: number,
      hi: number,
      min: number,
      max: number,
      m: number,
    ) => {
      if (hi - lo > max - min - 2 * m) return (min + max) / 2 - (lo + hi) / 2; // too big: centre
      return lo < min + m ? min + m - lo : hi > max - m ? max - m - hi : 0;
    };
    const dx = insideX ? 0 : slide(sx - halfW, sx + halfW, left, right, mx);
    const dy = insideY ? 0 : slide(sy - halfH, sy + halfH, top, bottom, my);
    return { x: camera.x - dx / zoom, y: camera.y - dy / zoom, zoom };
  }

  // the zoom changed: centre the focus in the middle of the VISIBLE area, not of the canvas.
  const visibleCx = (left + right) / 2,
    visibleCy = (top + bottom) / 2;
  const centredX = target.focus.x - (visibleCx - viewport.width / 2) / zoom;
  const centredY = target.focus.y - (visibleCy - viewport.height / 2) / zoom;
  return {
    x: centredX,
    y: centredY,
    zoom,
  };
}
