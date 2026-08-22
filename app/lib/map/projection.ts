/**
 * Web Mercator, normalised to the unit square.
 *
 * Everything upstream of the camera works in this space: geometry is built once as
 * Path2D in unit coordinates and drawn through a single canvas transform, so zooming
 * costs nothing per-frame. Latitude is clamped to ±85.05°, where Mercator's unit square
 * closes.
 */
export const MAX_LATITUDE = 85.05112878;
const RAD = Math.PI / 180;

export function lonToX(lon: number): number {
  return (lon + 180) / 360;
}

export function latToY(lat: number): number {
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const s = Math.sin(clamped * RAD);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

export function xToLon(x: number): number {
  return x * 360 - 180;
}

export function yToLat(y: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / RAD;
}

/** Wrap a unit-space x into [0, 1). The world repeats horizontally. */
export function wrapX(x: number): number {
  return ((x % 1) + 1) % 1;
}

/** Ground distance covered by one horizontal pixel, at a given latitude and zoom. */
export function kmPerPixel(lat: number, worldWidthPx: number): number {
  return (40075 * Math.cos(lat * RAD)) / worldWidthPx;
}
