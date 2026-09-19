/**
 * Turns the built payload into drawable, hit-testable geometry.
 *
 * Runs once per page load. The expensive parts — decoding 1957 arcs and building 240
 * Path2D objects — happen here so that every subsequent frame is a single transform and
 * a list of fills.
 */
import type {
  ContextShape, Feature, GeometryData, LonLat, PlaceMark, Ring, World, WorldData
} from './types';
import { latToY, lonToX, wrapX } from './projection';

/** Below this span in degrees a country cannot render as a recognisable shape. */
const MICRO_DEGREES = 0.55;

/**
 * Longitudes arrive in [-180, 180], so a ring that crosses the antimeridian (Russia's
 * mainland, via Chukotka) contains a ±360 jump. Unwrap it into one continuous frame: walk
 * the ring and whenever consecutive longitudes differ by more than 180, shift everything
 * after that point by ∓360. The result may run outside [-180, 180] — Russia becomes
 * roughly 19°E .. 190°E — and that is exactly what we want: a single Path2D subpath draws
 * it with no diagonal seam (the renderer already draws the world at −1, 0 and +1 world
 * widths, so a continuous path lands correctly in every copy with no clipping), and its
 * longitude span describes its real angular width instead of "the whole world".
 *
 * INVARIANT: longitudes stay unwrapped through all geometry and bbox maths below, and are
 * normalised (wrapX, or folded back into [-180, 180)) only at the moment they are handed
 * to the camera. Never before.
 */
export function unwrapRing(ring: Ring): Ring {
  if (ring.length < 2) return ring;
  const out: Ring = [ring[0]];
  let shift = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = ring[i][0] - ring[i - 1][0];
    if (d > 180) shift -= 360;
    else if (d < -180) shift += 360;
    out.push([ring[i][0] + shift, ring[i][1]]);
  }
  return out;
}

/**
 * A ring crossing the antimeridian inside itself is only half the bug. The USA's
 * Aleutians, Kiribati's three archipelagos and New Zealand's Chathams are each split into
 * separate rings (separate islands) that individually never cross ±180 — every ring in
 * KIR's outer-island group sits happily within its own hemisphere — but land on opposite
 * sides of it, so naively merging their raw longitudes into one bbox still produces "the
 * whole world" even after unwrapRing().
 *
 * Fixed the same way, one level up: shift each polygon (as a rigid unit — outer ring and
 * any holes together) by whichever multiple of 360° brings it closest to the country's own
 * reference longitude (its authored latlng, always in [-180, 180]). That puts every piece
 * of a feature into one mutually consistent frame regardless of how upstream happened to
 * split it into rings, with no per-country special case.
 */
function nearestBranch(lon: number, reference: number): number {
  return lon + Math.round((reference - lon) / 360) * 360;
}

function meanLon(ring: Ring): number {
  let sum = 0;
  for (const [lon] of ring) sum += lon;
  return sum / ring.length;
}

function decodeArcs(data: GeometryData): LonLat[][] {
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
 * Append a ring to a path as one continuous subpath. Safe to do unconditionally now that
 * every ring has already been unwrapped (see unwrapRing) — there is no jump left to break
 * on, and breaking mid-ring was what drew Russia and Fiji as diagonal slashes in the first
 * place: fill() implicitly closed the fragments across the whole canvas.
 */
function traceRing(path: Path2D, ring: Ring): void {
  let started = false;
  for (const point of ring) {
    const x = lonToX(point[0]);
    const y = latToY(point[1]);
    if (started) path.lineTo(x, y);
    else { path.moveTo(x, y); started = true; }
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
      tiny: true,
      path: null,
      fullPath: null,
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
          const ring = unwrapRing(buildRing(indices, arcs));
          if (ring.length < 3) continue;
          traceRing(path, ring);
          drew = true;
        }
      }
      if (drew) context.push({ path });
      continue;
    }

    for (const polygon of polygonList) {
      const rings = polygon
        .map(indices => unwrapRing(buildRing(indices, arcs)))
        .filter(r => r.length > 2);
      if (rings.length) feature.polygons.push(rings);
    }
  }

  // Not clickable, not joined to any country — see data.lakes's own doc comment for
  // where these come from. Built the same way context shapes are.
  const lakes: ContextShape[] = [];
  for (const lake of data.lakes) {
    const path = new Path2D();
    let drew = false;
    for (const indices of lake.arcs) {
      const ring = unwrapRing(buildRing(indices, arcs));
      if (ring.length < 3) continue;
      traceRing(path, ring);
      drew = true;
    }
    if (drew) lakes.push({ path });
  }

  for (const feature of features) {
    if (!feature.polygons.length) continue;
    finalizeFeature(feature, feature.polygons, 'path');
  }

  for (const feature of features) {
    feature.neighbours = feature.country.borders
      .map(iso3 => byIso3.get(iso3))
      .filter((f): f is Feature => Boolean(f));
  }

  const places: PlaceMark[] = [];
  for (const place of data.places) {
    const feature = byIso3.get(place.iso3);
    if (!feature) continue;
    places.push({ place, feature, ux: wrapX(lonToX(place.lon)), uy: latToY(place.lat) });
  }

  return { data, features, byIso3, bySlug, byId, context, lakes, fullContext: [], fullLakes: [], places };
}

/**
 * Computes bbox/anchor/tiny/(path or fullPath) from a feature's polygons and writes them
 * onto it — shared by buildWorld (coarse, on first load) and attachFullDetail (full, once
 * it arrives) so both go through identical maths. This turned out to matter for more than
 * tidiness: a coarse-detail centroid is close to but not identical to the full-detail one,
 * and that small a difference was once enough to move a country's own name label a few
 * pixels — a real visible difference once you're looking for it, not just an internal
 * approximation. attachFullDetail calls this again, with `target: 'fullPath'`, so a
 * country's camera-framing and label-placement geometry always matches full detail again
 * once it's loaded, exactly as before this file had two detail levels at all.
 */
function finalizeFeature(feature: Feature, polygons: Ring[][], target: 'path' | 'fullPath'): void {
  // Bring every disjoint piece of this feature into one consistent angular frame before
  // measuring anything — see nearestBranch's doc comment.
  const reference = feature.country.latlng[1];
  const shifted = polygons.map(polygon => {
    const shift = nearestBranch(meanLon(polygon[0]), reference) - meanLon(polygon[0]);
    if (!shift) return polygon;
    return polygon.map(ring => ring.map(([lon, lat]): LonLat => [lon + shift, lat]));
  });
  // reprojectToTrueSize (the size-comparison tool) reads this — always keep it in sync
  // with whichever detail level most recently ran through here, coarse or full.
  feature.polygons = shifted;

  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  let largest: Ring | null = null;
  let largestArea = -1;

  for (const polygon of shifted) {
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
  if (!Number.isFinite(feature.anchor[0]) || !Number.isFinite(feature.anchor[1])) {
    feature.anchor = [feature.country.latlng[1], feature.country.latlng[0]];
  }
  // The anchor can sit past 180° for a feature whose largest piece got shifted onto the
  // far branch above (see nearestBranch) — wrap it back into [0, 1) here, at the camera
  // boundary, per the invariant on unwrapRing.
  feature.ux = wrapX(lonToX(feature.anchor[0]));
  feature.uy = latToY(feature.anchor[1]);

  // width has to be corrected for latitude or every Arctic country looks enormous
  const midLat = (minLat + maxLat) / 2;
  const widthDeg = (maxLon - minLon) * Math.cos((midLat * Math.PI) / 180);
  feature.tiny = Math.max(widthDeg, maxLat - minLat) < MICRO_DEGREES;

  // Every feature with polygons gets a real path now, tiny or not — Malta and Vatican
  // City must be clickable shapes once you're zoomed in far enough to see them, not
  // permanent pins. The renderer decides per frame, from on-screen width, whether to
  // draw this path or a pin in its place; see renderer.ts's drawPins/drawShapes.
  const path = new Path2D();
  for (const polygon of shifted) for (const ring of polygon) traceRing(path, ring);
  feature[target] = path;
}

/**
 * Attaches full 1:10m detail to an already-painted (coarse-built) World, in place —
 * called once world.json arrives in the background (see geography/world.ts's loadWorld).
 * Recomputes bbox/anchor/tiny from the full geometry too (via finalizeFeature, the same
 * function buildWorld uses) — see that function's own doc comment for why a coarse-only
 * approximation there wasn't good enough to leave alone.
 */
export function attachFullDetail(world: World, data: GeometryData): void {
  const arcs = decodeArcs(data);
  const polygonsByFeature = new Map<Feature, Ring[][]>();

  for (const geometry of data.geometries) {
    const polygonList = (geometry.multi
      ? (geometry.arcs as number[][][])
      : [geometry.arcs as number[][]]);

    const feature = world.byId.get(geometry.id);

    if (!feature) {
      // no country record: Greenland, Western Sahara, overseas departments
      const path = new Path2D();
      let drew = false;
      for (const polygon of polygonList) {
        for (const indices of polygon) {
          const ring = unwrapRing(buildRing(indices, arcs));
          if (ring.length < 3) continue;
          traceRing(path, ring);
          drew = true;
        }
      }
      if (drew) world.fullContext.push({ path });
      continue;
    }

    for (const polygon of polygonList) {
      const rings = polygon
        .map(indices => unwrapRing(buildRing(indices, arcs)))
        .filter(r => r.length > 2);
      if (rings.length) {
        const list = polygonsByFeature.get(feature) ?? [];
        list.push(rings);
        polygonsByFeature.set(feature, list);
      }
    }
  }

  for (const [feature, polygons] of polygonsByFeature) {
    finalizeFeature(feature, polygons, 'fullPath');
  }

  for (const lake of data.lakes) {
    const path = new Path2D();
    let drew = false;
    for (const indices of lake.arcs) {
      const ring = unwrapRing(buildRing(indices, arcs));
      if (ring.length < 3) continue;
      traceRing(path, ring);
      drew = true;
    }
    if (drew) world.fullLakes.push({ path });
  }
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
