/**
 * Geometry for "Name the Country from its Outline": how large the silhouette is drawn in the
 * stage's fixed box, and where it lands. Pure maths (no React, no canvas) so it is unit-tested.
 */
import { latToY, lonToX } from '~/lib/map/projection';
import type { CountryRecord } from '~/lib/map/types';

/** Exponent of the size curve, displayed = box * (area / largestInPool) ^ OUTLINE_SIZE_EXPONENT.
 *  Deliberately tiny: a true-to-area scale would draw Malta as a dot and Russia as the box,
 *  while 0.15 keeps size a mild hint (Russia 100%, France ~60%) without giving the answer away. */
export const OUTLINE_SIZE_EXPONENT = 0.15;

/** Smallest share of the box a silhouette is drawn at, so microstates stay readable. */
export const OUTLINE_MIN_SHARE = 0.3;

/** Share (OUTLINE_MIN_SHARE..1) of the box this country's silhouette is fitted into. Normalised
 *  against the largest country IN THE CURRENT POOL, so an Oceania run isn't all at the floor. */
export function outlineShare(country: CountryRecord, pool: CountryRecord[]): number {
  const largest = pool.reduce((max, c) => Math.max(max, c.area), 0);
  if (!(largest > 0) || !(country.area > 0)) return OUTLINE_MIN_SHARE;
  const share = Math.pow(country.area / largest, OUTLINE_SIZE_EXPONENT);
  return Math.min(1, Math.max(OUTLINE_MIN_SHARE, share));
}

/** Where to draw a path that lives in unit-square map space (topology.ts's Path2D): a uniform
 *  scale and translation that contain-fits the bbox [minLon, minLat, maxLon, maxLat] into
 *  `share` of a width x height box, centred. Longitudes are the UNWRAPPED frame, as in
 *  topology.ts, so Russia or Fiji is one continuous shape, not two halves. North is up. */
export function outlineTransform(
  bbox: [number, number, number, number],
  share: number,
  width: number,
  height: number
): { scale: number; tx: number; ty: number } {
  const x0 = lonToX(bbox[0]);
  const x1 = lonToX(bbox[2]);
  const y0 = latToY(bbox[3]); // north edge = smaller y
  const y1 = latToY(bbox[1]);
  const w = Math.max(x1 - x0, 1e-9);
  const h = Math.max(y1 - y0, 1e-9);
  const scale = Math.min((width * share) / w, (height * share) / h);
  return {
    scale,
    tx: width / 2 - ((x0 + x1) / 2) * scale,
    ty: height / 2 - ((y0 + y1) / 2) * scale
  };
}
