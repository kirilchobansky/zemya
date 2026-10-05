/**
 * Turns the built payload into drawable, hit-testable geometry.
 *
 * Runs once per page load. The expensive parts — decoding 1957 arcs and building 240
 * Path2D objects — happen here so that every subsequent frame is a single transform and
 * a list of fills.
 */
import type {
  Feature, GeometryData, LonLat, PlaceMark, Ring, World, WorldData
} from './types';
import { latToY, lonToX, wrapX } from './projection';
import { buildRing, decodeArcs, frameToReference, unwrapRing } from '../../../scripts/lib/geom.mjs';

// Antimeridian handling lives in scripts/lib/geom.mjs, shared with the tile builder so the
// vector tiles and these Features always agree on the longitude frame (see its header).
export { unwrapRing };

/** Below this span in degrees a country cannot render as a recognisable shape. */
const MICRO_DEGREES = 0.55;

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
      pieceWidth: 0,
      neighbours: [],
      halo: null
    };
    features.push(feature);
    byId.set(country.id, feature);
    byIso3.set(country.iso3, feature);
    bySlug.set(country.slug, feature);
  }

    for (const geometry of data.geometries) {
    const polygonList = (geometry.multi
      ? (geometry.arcs as number[][][])
      : [geometry.arcs as number[][]]);

    const feature = byId.get(geometry.id);

    // no country record (Greenland, Western Sahara, dependencies): shapes only, drawn from
    // the vector tiles — nothing to build here
    if (!feature) continue;

    for (const polygon of polygonList) {
      const rings = polygon
        .map(indices => unwrapRing(buildRing(indices, arcs)))
        .filter(r => r.length > 2);
      if (rings.length) feature.polygons.push(rings);
    }
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

  // Halos come from the payload already unwrapped into the land's own frame (build-content),
  // so they are only traced here, never re-derived.
  const haloFeatures: Feature[] = [];
  for (const { id, ring } of data.halos) {
    const feature = byId.get(id);
    if (!feature || ring.length < 3) continue;
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    const x0 = lonToX(minLon), x1 = lonToX(maxLon), y0 = latToY(maxLat), y1 = latToY(minLat);
    feature.halo = { x0, x1, y0, y1, area: (x1 - x0) * (y1 - y0) };
    haloFeatures.push(feature);
  }
  haloFeatures.sort((a, b) => a.halo!.area - b.halo!.area);

  const places: PlaceMark[] = [];
  for (const place of data.places) {
    const feature = byIso3.get(place.iso3);
    if (!feature) continue;
    places.push({ place, feature, ux: wrapX(lonToX(place.lon)), uy: latToY(place.lat) });
  }

  return { data, features, byIso3, bySlug, byId, places, haloFeatures };
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
  // measuring anything — see frameToReference in scripts/lib/geom.mjs.
  const shifted = frameToReference(polygons, feature.country.latlng[1]);
  // reprojectToTrueSize (the size-comparison tool) reads this — always keep it in sync
  // with whichever detail level most recently ran through here, coarse or full.
  feature.polygons = shifted;

  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  let largest: Ring | null = null;
  let largestArea = -1;
  let pieceWidth = 0;

  for (const polygon of shifted) {
    const outer = polygon[0];
    const area = ringArea(outer);
    if (area > largestArea) { largestArea = area; largest = outer; }
    let pieceMin = Infinity, pieceMax = -Infinity;
    for (const [lon, lat] of outer) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lon < pieceMin) pieceMin = lon;
      if (lon > pieceMax) pieceMax = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    pieceWidth = Math.max(pieceWidth, lonToX(pieceMax) - lonToX(pieceMin));
  }
  feature.pieceWidth = pieceWidth;

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

    if (!feature) continue;

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
  return reprojectPolygonsToTrueSize(feature, targetLon, targetLat).flat();
}

/** reprojectToTrueSize, keeping the polygon grouping (outer ring first, then its holes) —
 *  what the GL renderer needs to fill a polygon with its holes cut out. */
export function reprojectPolygonsToTrueSize(
  feature: Feature,
  targetLon: number,
  targetLat: number
): Ring[][] {
  const KM_PER_DEG_LAT = 110.574;
  const KM_PER_DEG_LON = 111.32;
  const RAD = Math.PI / 180;
  const [originLon, originLat] = feature.anchor;

  return feature.polygons.map(polygon =>
    polygon.map(ring => {
      const moved: Ring = [];
      for (const [lon, lat] of ring) {
        const northKm = (lat - originLat) * KM_PER_DEG_LAT;
        const eastKm = (lon - originLon) * KM_PER_DEG_LON * Math.cos(lat * RAD);
        const newLat = targetLat + northKm / KM_PER_DEG_LAT;
        const cos = Math.cos(newLat * RAD);
        const newLon = targetLon + eastKm / (KM_PER_DEG_LON * (Math.abs(cos) < 1e-4 ? 1e-4 : cos));
        moved.push([newLon, newLat]);
      }
      return moved;
    })
  );
}
