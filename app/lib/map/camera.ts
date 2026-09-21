/**
 * Camera over the unit-square Mercator world.
 *
 * `zoom` is the width of the whole world in CSS pixels, which makes every conversion a
 * multiply: a country 0.02 units wide is `0.02 * zoom` pixels across.
 *
 * There are two cameras — where we are, and where we are going. The important rule is
 * that **each is clamped against its own zoom**. Clamping the target against the current
 * zoom is subtly wrong and produces a bug that looks like nothing: at world zoom the
 * vertical clamp collapses to exactly 0.5, so a fly-to that wants to centre on Nepal has
 * its target latitude silently rewritten to the equator, and the camera zooms into empty
 * ocean.
 */
import { wrapX } from './projection';

/** Pixels of the canvas covered by something on top of it, per side — the phone's bottom
 *  sheet and tab bar, a quiz's docked input. The "visible map area" is the viewport minus these. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface Viewport {
  width: number;
  height: number;
  /** What covers the canvas, if anything — the camera keeps the VISIBLE area inside the map. */
  insets?: Insets;
}

const hasInsets = (i: Insets | undefined): i is Insets => Boolean(i && (i.top || i.right || i.bottom || i.left));

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/** Zoom at which the world fills the viewport. */
export function homeZoom(v: Viewport): number {
  return Math.min(v.width / 0.99, v.height / 0.7);
}

const MIN_FACTOR = 0.78;
const MAX_FACTOR = 320;

export function clampZoom(zoom: number, v: Viewport): number {
  const home = homeZoom(v);
  return Math.max(home * MIN_FACTOR, Math.min(home * MAX_FACTOR, zoom));
}

/**
 * Keep the viewport inside the map vertically. At wide zooms the world is shorter than
 * the viewport, so both bounds collapse to 0.5 and the map simply centres.
 */
export function clampY(y: number, zoom: number, v: Viewport): number {
  // The rule applies to the visible area's centre: with a sheet covering the bottom, the
  // visible area is centred (top - bottom) / 2 px below the camera's own y.
  const ins = v.insets ?? NO_INSETS;
  const shift = (ins.top - ins.bottom) / 2 / zoom;
  const half = (v.height - ins.top - ins.bottom) / 2 / zoom;
  const low = Math.min(0.5, half);
  const high = Math.max(0.5, 1 - half);
  return Math.max(low, Math.min(high, y + shift)) - shift;
}

export function clamp(state: CameraState, v: Viewport): CameraState {
  const zoom = clampZoom(state.zoom, v);
  return { x: state.x, y: clampY(state.y, zoom, v), zoom };
}

export function screenToWorld(
  c: CameraState, v: Viewport, sx: number, sy: number
): [number, number] {
  return [(sx - v.width / 2) / c.zoom + c.x, (sy - v.height / 2) / c.zoom + c.y];
}

export function worldToScreen(
  c: CameraState, v: Viewport, wx: number, wy: number
): [number, number] {
  let dx = wx - wrapX(c.x);
  dx -= Math.round(dx);                       // always take the short way round
  return [dx * c.zoom + v.width / 2, (wy - c.y) * c.zoom + v.height / 2];
}

export const HOME: Omit<CameraState, 'zoom'> = { x: 0.5, y: 0.46 };

/**
 * Where a camera must look so that map point (wx, wy) appears in the middle of the VISIBLE area
 * rather than of the whole viewport: the camera centre is the screen centre, and the visible
 * area's centre sits (left - right) / 2, (top - bottom) / 2 px away from it. A no-op without insets.
 */
export function centreInVisible(wx: number, wy: number, zoom: number, insets: Insets): { x: number; y: number } {
  return {
    x: wx - (insets.left - insets.right) / 2 / zoom,
    y: wy - (insets.top - insets.bottom) / 2 / zoom
  };
}

/** The world view. With insets the world is fitted to, and centred in, the visible area. */
export function homeCamera(v: Viewport, insets: Insets | undefined = v.insets): CameraState {
  if (!hasInsets(insets)) return { ...HOME, zoom: homeZoom(v) };
  const inner = {
    width: Math.max(1, v.width - insets.left - insets.right),
    height: Math.max(1, v.height - insets.top - insets.bottom)
  };
  const zoom = clampZoom(homeZoom(inner), v);
  return clamp({ ...centreInVisible(HOME.x, HOME.y, zoom, insets), zoom }, { ...v, insets });
}

/** Frame a bounding box in unit space, with padding, without exceeding the zoom limits. */
export function frame(
  box: { x0: number; y0: number; x1: number; y1: number },
  v: Viewport,
  padding = 0.55,
  maxFactor = Infinity,
  insets: Insets = v.insets ?? NO_INSETS
): CameraState {
  // The floor below matters for the smallest states: 0.004 units (~160 km) used to leave
  // Vatican City (~1 km across) at about 5 px on screen however hard you tried to zoom in
  // on it. 0.0002 units (~8 km) lets the smallest real countries actually fill the frame.
  const width = Math.max(box.x1 - box.x0, 0.0002);
  const height = Math.max(box.y1 - box.y0, 0.0002);
  const home = homeZoom(v);
  const visibleW = Math.max(1, v.width - insets.left - insets.right);
  const visibleH = Math.max(1, v.height - insets.top - insets.bottom);
  const fit = Math.min((visibleW / width) * padding, (visibleH / height) * padding);
  const zoom = Math.min(fit, home * maxFactor);
  return clamp(
    {
      ...centreInVisible((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, clampZoom(zoom, v), insets),
      zoom
    },
    { ...v, insets }
  );
}

/**
 * One step of an exponential ease. Zoom interpolates geometrically so that the rate of
 * apparent movement is constant — linear interpolation of zoom crawls at the far end and
 * lurches at the near end.
 */
export function step(from: CameraState, to: CameraState, k = 0.19): CameraState {
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    zoom: from.zoom * Math.pow(to.zoom / from.zoom, k)
  };
}

export function settled(from: CameraState, to: CameraState): boolean {
  return (
    Math.abs(to.x - from.x) < 1e-5 &&
    Math.abs(to.y - from.y) < 1e-5 &&
    Math.abs(1 - to.zoom / from.zoom) < 1e-3
  );
}

/**
 * Shift a target so the animation crosses the antimeridian rather than scrolling the
 * long way round the planet. Returns a target x that may sit outside [0, 1); callers wrap
 * it once the animation settles.
 */
export function shortestX(currentX: number, targetX: number): number {
  const current = wrapX(currentX);
  if (Math.abs(targetX - current) > 0.5) return targetX + (targetX < current ? 1 : -1);
  return targetX;
}
