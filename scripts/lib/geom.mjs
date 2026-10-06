/**
 * Geometry decoding shared by the in-browser world builder (app/engines/map/topology.ts) and the
 * build-time tile builder (scripts/build/build-tiles.mjs). Pure maths, no imports. One copy on
 * purpose: the vector tiles and the Feature records (bbox, anchor, hit-test pieces) must put
 * every polygon in the SAME longitude frame, and two implementations would drift.
 *
 * INVARIANT (unchanged from topology.ts): longitudes stay unwrapped (a country may run past
 * +-180) through all geometry work; they are folded back only where something needs it —
 * the camera, and the tile cutter, which wraps for itself.
 */

/** Delta-encoded, quantised arcs (GeometryData.arcs) -> absolute [lon, lat] arcs. */
export function decodeArcs(data) {
  const { x0, y0, xs, ys } = data.grid;
  return data.arcs.map(arc => {
    let x = 0;
    let y = 0;
    const out = new Array(arc.length);
    for (let i = 0; i < arc.length; i++) {
      x += arc[i][0];
      y += arc[i][1];
      out[i] = [x * xs + x0, y * ys + y0];
    }
    return out;
  });
}

/** Stitch arc indices into a ring. A negative index means "that arc, reversed". */
export function buildRing(indices, arcs) {
  let points = [];
  for (const index of indices) {
    const reversed = index < 0;
    const arc = arcs[reversed ? ~index : index];
    if (!arc) continue;
    const segment = reversed ? arc.slice().reverse() : arc;
    points = points.length ? points.concat(segment.slice(1)) : segment.slice();
  }
  return points;
}

/**
 * Longitudes arrive in [-180, 180], so a ring that crosses the antimeridian (Russia's
 * mainland, via Chukotka) contains a +-360 jump. Walk the ring and whenever consecutive
 * longitudes differ by more than 180, shift everything after that point by -+360. The result
 * may run outside [-180, 180] (Russia becomes roughly 19E .. 190E), which is exactly what
 * we want: one continuous ring with no seam.
 */
export function unwrapRing(ring) {
  if (ring.length < 2) return ring;
  const out = [ring[0]];
  let shift = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = ring[i][0] - ring[i - 1][0];
    if (d > 180) shift -= 360;
    else if (d < -180) shift += 360;
    out.push([ring[i][0] + shift, ring[i][1]]);
  }
  return out;
}

/** `lon` moved by whole turns to the branch nearest `reference`. */
export function nearestBranch(lon, reference) {
  return lon + Math.round((reference - lon) / 360) * 360;
}

export function meanLon(ring) {
  let sum = 0;
  for (const [lon] of ring) sum += lon;
  return sum / ring.length;
}

/**
 * Put every disjoint piece of a feature into one mutually consistent frame: each polygon
 * (outer ring and holes together, as a rigid unit) is shifted by whichever multiple of 360
 * brings it closest to the country's own reference longitude (its authored latlng). The USA's
 * Aleutians, Kiribati's archipelagos and the Chathams are separate rings that each sit inside
 * one hemisphere but land on opposite sides of the antimeridian; this is what joins them.
 */
export function frameToReference(polygons, reference) {
  return polygons.map(polygon => {
    const shift = nearestBranch(meanLon(polygon[0]), reference) - meanLon(polygon[0]);
    if (!shift) return polygon;
    return polygon.map(ring => ring.map(([lon, lat]) => [lon + shift, lat]));
  });
}
