/**
 * Where the camera goes when a country is opened from a finished quiz's results: nowhere if the
 * player can already see it (or, for a small one, its neighbourhood framed), otherwise a gentle
 * framing — never a close-up of the one country. Small countries that were missed together and
 * sit near each other (the Caribbean) are framed as a group, so stepping from one to the next
 * does not move the camera. Pure: GlCamera#nudgeTo feeds it the camera and moves to the answer.
 */
import { centreInVisible, clamp, frame, homeZoom, type CameraState, type Insets, type Viewport } from './camera';
import { markerPoint } from './follow';
import { latToY, lonToX } from './projection';
import type { Feature } from './types';

/** A country narrower than this (world-width fraction; 0.02 = ~800 km) counts as small and is framed
 *  with the other small missed countries near it; a bigger one is only brought into view. */
export const INSPECT_SMALL_UNITS = 0.02;
/** Small missed countries within this distance (world-width fraction) of the opened one are framed
 *  together. 0.12 covers the whole Caribbean. */
export const INSPECT_CLUSTER_RADIUS = 0.12;
/** How much of the screen the framed area fills (0.5 = half; lower = more surroundings visible). */
export const INSPECT_PADDING = 0.5;
/** The most the nudge zooms in, as a multiple of the world view (a lone tiny island stops here). */
export const INSPECT_MAX_ZOOM_FACTOR = 12;
/** A cluster is "already framed" when the camera is at least this fraction of the zoom we would pick. */
const ENOUGH_ZOOM = 0.8;
/** Distance from the screen edge (px) a country must keep to count as visible. */
const EDGE_PX = 24;

interface Box { x0: number; y0: number; x1: number; y1: number }

function boxOf(feature: Feature): Box | null {
  if (feature.bbox) {
    const [minLon, minLat, maxLon, maxLat] = feature.bbox;
    return { x0: lonToX(minLon), x1: lonToX(maxLon), y0: latToY(maxLat), y1: latToY(minLat) };
  }
  const p = markerPoint(feature, null);
  return p ? { x0: p.x, x1: p.x, y0: p.y, y1: p.y } : null;
}

const centre = (b: Box) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });

export function inspectCamera(
  feature: Feature, group: readonly Feature[], cam: CameraState, viewport: Viewport, insets: Insets
): CameraState | null {
  const own = boxOf(feature);
  if (!own) return null;
  const visible = (b: Box): boolean => {
    const c = centre(b);
    const sx = viewport.width / 2 + (c.x - cam.x) * cam.zoom;
    const sy = viewport.height / 2 + (c.y - cam.y) * cam.zoom;
    return sx >= insets.left + EDGE_PX && sx <= viewport.width - insets.right - EDGE_PX &&
      sy >= insets.top + EDGE_PX && sy <= viewport.height - insets.bottom - EDGE_PX;
  };
  const small = (b: Box) => b.x1 - b.x0 < INSPECT_SMALL_UNITS;

  let box = own;
  if (small(own)) {
    const c = centre(own);
    for (const other of group) {
      const b = boxOf(other);
      if (!b || !small(b)) continue;
      const o = centre(b);
      if (Math.hypot(o.x - c.x, o.y - c.y) > INSPECT_CLUSTER_RADIUS) continue;
      box = { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) };
    }
  }
  const target = frame(box, viewport, INSPECT_PADDING, INSPECT_MAX_ZOOM_FACTOR, insets);
  // a big country only needs to be on screen; a small one needs its (group) area framed closely enough
  if (visible(box) && (!small(own) || cam.zoom >= target.zoom * ENOUGH_ZOOM)) return null;
  return clamp(target, { ...viewport, insets });
}
