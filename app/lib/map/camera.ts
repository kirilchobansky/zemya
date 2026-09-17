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

export interface Viewport {
  width: number;
  height: number;
}

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
  const half = v.height / 2 / zoom;
  const low = Math.min(0.5, half);
  const high = Math.max(0.5, 1 - half);
  return Math.max(low, Math.min(high, y));
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

export function homeCamera(v: Viewport): CameraState {
  return { ...HOME, zoom: homeZoom(v) };
}

/** Frame a bounding box in unit space, with padding, without exceeding the zoom limits. */
export function frame(
  box: { x0: number; y0: number; x1: number; y1: number },
  v: Viewport,
  padding = 0.55,
  maxFactor = Infinity
): CameraState {
  // The floor below matters for the smallest states: 0.004 units (~160 km) used to leave
  // Vatican City (~1 km across) at about 5 px on screen however hard you tried to zoom in
  // on it. 0.0002 units (~8 km) lets the smallest real countries actually fill the frame.
  const width = Math.max(box.x1 - box.x0, 0.0002);
  const height = Math.max(box.y1 - box.y0, 0.0002);
  const home = homeZoom(v);
  const fit = Math.min((v.width / width) * padding, (v.height / height) * padding);
  return clamp(
    {
      x: (box.x0 + box.x1) / 2,
      y: (box.y0 + box.y1) / 2,
      zoom: Math.min(fit, home * maxFactor)
    },
    v
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
