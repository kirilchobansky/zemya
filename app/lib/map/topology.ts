/**
 * Turns the built payload into drawable, hit-testable geometry.
 *
 * Runs once per page load. The expensive parts — decoding 1957 arcs and building 240
 * Path2D objects — happen here so that every subsequent frame is a single transform and
 * a list of fills.
 */
import type {
  ContextShape, Feature, LonLat, Ring, World, WorldData
} from './types';
import { latToY, lonToX } from './projection';

/** Longitude jump that means a ring crossed the antimeridian rather than moved. */
const WRAP_JUMP = 180;
/** Below this span in degrees a country cannot render as a recognisable shape. */
const MICRO_DEGREES = 0.55;

function decodeArcs(data: WorldData): LonLat[][] {
  const { x0, y0, xs, ys } = data.grid;
  return data.arcs.map(arc => {
    let x = 0;
    let y = 0;
    const out: LonLat[] = new Array(arc.length);
    for (let i = 0; i < arc.length; i++) {
      x += arc[i][0];
      y += arc[i][1];
      out[i] = [x * xs + x0, y * ys + y0];
    }
    return out;
  });
}

/** Stitch arc indices into a ring. A negative index means "that arc, reversed". */
function buildRing(indices: number[], arcs: LonLat[][]): Ring {
  let points: Ring = [];
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
 * Append a ring to a path, breaking the subpath wherever the ring jumps the
 * antimeridian. Without the break, Russia and Fiji smear a horizontal band across the
 * entire map.
 */
function traceRing(path: Path2D, ring: Ring): void {
  let started = false;
  let previous: LonLat | null = null;
  for (const point of ring) {
    if (previous && Math.abs(point[0] - previous[0]) > WRAP_JUMP) started = false;
    const x = lonToX(point[0]);
    const y = latToY(point[1]);
    if (started) path.lineTo(x, y);
    else { path.moveTo(x, y); started = true; }
    previous = point;
  }
  path.closePath();
}

/** Shoelace area in square degrees. Only used to pick the largest polygon. */
function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(sum / 2);
}

export function buildWorld(data: WorldData): World {
  const arcs = decodeArcs(data);

  const byId = new Map<string, Feature>();
  const byIso3 = new Map<string, Feature>();
  const bySlug = new Map<string, Feature>();
  const features: Feature[] = [];

  for (const country of data.countries) {
    const feature: Feature = {
      country,
      polygons: [],
      bbox: null,
      anchor: [country.latlng[1], country.latlng[0]],
      ux: 0,
      uy: 0,
      micro: true,
      path: null,
      neighbours: []
    };
    features.push(feature);
    byId.set(country.id, feature);
    byIso3.set(country.iso3, feature);
    bySlug.set(country.slug, feature);
  }

  const context: ContextShape[] = [];

  for (const geometry of data.geometries) {
    const polygonList = (geometry.multi
      ? (geometry.arcs as number[][][])
      : [geometry.arcs as number[][]]);

    const feature = byId.get(geometry.id);

    if (!feature) {
      // no country record: Greenland, Western Sahara, overseas departments. Drawn dim,
      // never clickable — the map would look broken with holes in it.
      const path = new Path2D();
      let drew = false;
      for (const polygon of polygonList) {
        for (const indices of polygon) {
          const ring = buildRing(indices, arcs);
          if (ring.length < 3) continue;
          traceRing(path, ring);
          drew = true;
        }
      }
      if (drew) context.push({ path });
      continue;
    }

    for (const polygon of polygonList) {
      const rings = polygon.map(indices => buildRing(indices, arcs)).filter(r => r.length > 2);
      if (rings.length) feature.polygons.push(rings);
    }
  }

  for (const feature of features) {
    if (!feature.polygons.length) continue;

    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    let largest: Ring | null = null;
    let largestArea = -1;

    for (const polygon of feature.polygons) {
      const outer = polygon[0];
      const area = ringArea(outer);
      if (area > largestArea) { largestArea = area; largest = outer; }
      for (const [lon, lat] of outer) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }

    feature.bbox = [minLon, minLat, maxLon, maxLat];

    if (largest) {
      let sx = 0, sy = 0;
      for (const [lon, lat] of largest) { sx += lon; sy += lat; }
      feature.anchor = [sx / largest.length, sy / largest.length];
    }

    // width has to be corrected for latitude or every Arctic country looks enormous
    const midLat = (minLat + maxLat) / 2;
    const widthDeg = (maxLon - minLon) * Math.cos((midLat * Math.PI) / 180);
    feature.micro = Math.max(widthDeg, maxLat - minLat) < MICRO_DEGREES;

    if (!feature.micro) {
      const path = new Path2D();
      for (const polygon of feature.polygons) for (const ring of polygon) traceRing(path, ring);
      feature.path = path;
    }
  }

  for (const feature of features) {
    if (!Number.isFinite(feature.anchor[0]) || !Number.isFinite(feature.anchor[1])) {
      feature.anchor = [feature.country.latlng[1], feature.country.latlng[0]];
    }
    feature.ux = lonToX(feature.anchor[0]);
    feature.uy = latToY(feature.anchor[1]);
    feature.neighbours = feature.country.borders
      .map(iso3 => byIso3.get(iso3))
      .filter((f): f is Feature => Boolean(f));
  }

  return { data, features, byIso3, bySlug, byId, context };
}

/**
 * Re-project a country's rings so their *ground* dimensions are preserved when placed at
 * a new location. Vertices are converted to kilometre offsets from the shape's anchor,
 * then converted back at the destination latitude. Drawn through Mercator, the result
 * grows towards the poles exactly as the projection distorts everything else — which is
 * the whole point of the comparison.
 */
export function reprojectToTrueSize(
  feature: Feature,
  targetLon: number,
  targetLat: number
): Ring[] {
  const KM_PER_DEG_LAT = 110.574;
  const KM_PER_DEG_LON = 111.32;
  const RAD = Math.PI / 180;
  const [originLon, originLat] = feature.anchor;
  const out: Ring[] = [];

  for (const polygon of feature.polygons) {
    for (const ring of polygon) {
      const moved: Ring = [];
      for (const [lon, lat] of ring) {
        const northKm = (lat - originLat) * KM_PER_DEG_LAT;
        const eastKm = (lon - originLon) * KM_PER_DEG_LON * Math.cos(lat * RAD);
        const newLat = targetLat + northKm / KM_PER_DEG_LAT;
        const cos = Math.cos(newLat * RAD);
        const newLon = targetLon + eastKm / (KM_PER_DEG_LON * (Math.abs(cos) < 1e-4 ? 1e-4 : cos));
        moved.push([newLon, newLat]);
      }
      out.push(moved);
    }
  }
  return out;
}

/** Build a Path2D from already-projected lon-lat rings (used for the dragged outline). */
export function ringsToPath(rings: Ring[]): Path2D {
  const path = new Path2D();
  for (const ring of rings) traceRing(path, ring);
  return path;
}
