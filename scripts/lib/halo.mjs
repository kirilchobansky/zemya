/**
 * Territory halos for island nations: a rounded convex shape around all of a country's
 * islands, so a country too small to see at world zoom has an area to look at and tap.
 * Pure maths, no imports — scripts/build/build-content.mjs calls it, scripts/lib/halo.test.ts
 * checks it.
 *
 * Qualifying countries are derived (`qualifiesForHalo`), never listed: no land borders
 * and under HALO_MAX_AREA_KM2, minus HALO_EXCLUDED. Land micro-states (Monaco, Vatican City) keep their pins.
 */

export const HALO_MAX_AREA_KM2 = 25000;
/** Buffer = max(this, HALO_SPAN_SHARE of the hull's longest span). */
export const HALO_MIN_BUFFER_KM = 120;
export const HALO_SPAN_SHARE = 0.15;
export const HALO_MAX_POINTS = 48;
/** An unwrapped halo wider than this means the antimeridian handling failed. */
export const HALO_MAX_LON_SPAN = 60;

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32;
const RAD = Math.PI / 180;
/** Points per full circle when rounding the hull's corners. */
const CORNER_STEPS = 24;

/** A halo is a territory wash over open sea. Where more than this share of its area is another
 *  country's land (Singapore: 36% Malaysia and Indonesia) it would paint a neighbour, so the
 *  country is a dot instead. Everyone else measures under 4%. */
export const HALO_MAX_NEIGHBOUR_SHARE = 0.15;

/** Owner's call: Jamaica, the Caribbean, Malta and Cyprus keep their dots (and their land shapes once
 *  zoomed in) — a halo there read as clutter over a crowded or already-legible region. */
export const HALO_EXCLUDED = new Set([
  'JAM', 'ATG', 'BRB', 'DMA', 'GRD', 'KNA', 'LCA', 'VCT', 'TTO', 'MLT', 'CYP', 'BHR'
]);

export function qualifiesForHalo(country) {
  return country.borders.length === 0 && country.area < HALO_MAX_AREA_KM2 && !HALO_EXCLUDED.has(country.iso3);
}

/* Longitude unwrapping — the SAME rules as app/engines/map/topology.ts (unwrapRing, then a
   rigid per-polygon shift onto the branch nearest the country's own longitude), so the
   halo lands in exactly the frame the client puts the country's land in. Keep in sync. */

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

function nearestBranch(lon, reference) {
  return lon + Math.round((reference - lon) / 360) * 360;
}

function meanLon(ring) {
  let sum = 0;
  for (const [lon] of ring) sum += lon;
  return sum / ring.length;
}

/** `polygons`: one array of rings per polygon, raw (wrapped) lon/lat, outer ring first.
 *  `referenceLon`: the country's own longitude (latlng[1]). Returns every outer-ring
 *  vertex in one consistent unwrapped frame. */
export function unwrappedVertices(polygons, referenceLon) {
  const out = [];
  for (const polygon of polygons) {
    const outer = unwrapRing(polygon[0]);
    if (outer.length < 3) continue;
    const shift = nearestBranch(meanLon(outer), referenceLon) - meanLon(outer);
    for (const [lon, lat] of outer) out.push([lon + shift, lat]);
  }
  return out;
}

/** Andrew's monotone chain. Returns the hull counter-clockwise, no repeated endpoint. */
export function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Drop the vertex whose triangle with its neighbours is smallest, until `max` remain
 *  (Visvalingam). On a convex ring that sheds the flattest stretches of the outline first. */
export function simplifyRing(ring, max) {
  const pts = ring.slice();
  const area = (i) => {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  };
  while (pts.length > max) {
    let worst = 0, worstArea = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = area(i);
      if (a < worstArea) { worstArea = a; worst = i; }
    }
    pts.splice(worst, 1);
  }
  return pts;
}

/**
 * The halo ring (lon/lat, unwrapped frame, at most HALO_MAX_POINTS) for one country, or
 * null when there are no vertices. Hull in a local kilometre plane (cos(latitude)-corrected
 * at the hull's middle latitude), buffered with round corners, simplified, converted back.
 */
export function buildHalo(vertices) {
  if (!vertices.length) return null;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const [lon, lat] of vertices) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  const lat0 = (minLat + maxLat) / 2;
  const lon0 = (minLon + maxLon) / 2;
  const kmPerLon = KM_PER_DEG_LON * Math.cos(lat0 * RAD);
  const toKm = ([lon, lat]) => [(lon - lon0) * kmPerLon, (lat - lat0) * KM_PER_DEG_LAT];

  const hull = convexHull(vertices.map(toKm));

  let span = 0;
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      span = Math.max(span, Math.hypot(hull[i][0] - hull[j][0], hull[i][1] - hull[j][1]));
    }
  }
  const buffer = Math.max(HALO_MIN_BUFFER_KM, HALO_SPAN_SHARE * span);

  // Minkowski sum with a disc: a circle of points round every hull vertex, hulled again
  const rounded = [];
  for (const [x, y] of hull) {
    for (let k = 0; k < CORNER_STEPS; k++) {
      const t = (k / CORNER_STEPS) * Math.PI * 2;
      rounded.push([x + buffer * Math.cos(t), y + buffer * Math.sin(t)]);
    }
  }
  const ring = simplifyRing(convexHull(rounded), HALO_MAX_POINTS);

  return ring.map(([x, y]) => [
    Math.round((lon0 + x / kmPerLon) * 100) / 100,
    Math.round((lat0 + y / KM_PER_DEG_LAT) * 100) / 100
  ]);
}

/** Longitude span of a halo ring, in degrees. */
export function haloLonSpan(ring) {
  let min = Infinity, max = -Infinity;
  for (const [lon] of ring) {
    if (lon < min) min = lon;
    if (lon > max) max = lon;
  }
  return max - min;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The share (0..1) of a halo's area that lies on other countries' land, sampled on a 40x40 grid.
 * `others`: every polygon of every OTHER country as `{ ring, bbox: [minLon, minLat, maxLon, maxLat] }`
 * (outer ring, raw lon/lat); a polygon is also tried 360 degrees either side, so a halo unwrapped
 * across the antimeridian still meets it.
 */
export function neighbourLandShare(haloRing, others) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of haloRing) {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  const N = 40;
  let total = 0, land = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = minLon + ((i + 0.5) / N) * (maxLon - minLon);
      const y = minLat + ((j + 0.5) / N) * (maxLat - minLat);
      if (!pointInRing(x, y, haloRing)) continue;
      total += 1;
      const onLand = others.some(({ ring, bbox }) =>
        y >= bbox[1] && y <= bbox[3] &&
        [0, 360, -360].some(shift => x + shift >= bbox[0] && x + shift <= bbox[2] && pointInRing(x + shift, y, ring)));
      if (onLand) land += 1;
    }
  }
  return total ? land / total : 0;
}
