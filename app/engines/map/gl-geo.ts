/**
 * GeoJSON the GL renderer feeds MapLibre at runtime: the small point sets (country anchors,
 * capitals), the graticule and the size-comparison outline. Country, context, lake and halo
 * SHAPES are not here — they come from the vector tiles (scripts/build-tiles.mjs).
 * Types only from maplibre-gl, so importing this never pulls the library in.
 */
import type { Feature as GeoFeature, FeatureCollection, MultiPolygon } from 'geojson';

import { MAX_LATITUDE } from './projection';
import type { Ring, World } from './types';

/** Label size by country area: Malta 10 px up to Russia 14. The canvas renderer scaled the
 *  size with the on-screen width each frame; a symbol layer's size cannot depend on both zoom
 *  and the feature, so it is a property of the country instead. */
export function labelSize(area: number): number {
  return Math.min(14, Math.max(10, Math.round(2.2 * Math.log10(Math.max(area, 1)))));
}

/** One point per country at its anchor (the pin, the dot, the name). `iso3` is the feature id. */
export function anchorPoints(world: World): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: world.features.map((feature): GeoFeature => ({
      type: 'Feature',
      properties: { iso3: feature.country.iso3, name: feature.country.name, area: feature.country.area, sz: labelSize(feature.country.area) },
      geometry: { type: 'Point', coordinates: feature.anchor }
    }))
  };
}

/** One point per capital. `iso3` is the owning country; `iso3` is the feature id too (one each). */
export function capitalPoints(world: World): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: world.places.map(({ place }): GeoFeature => ({
      type: 'Feature',
      properties: { iso3: place.iso3, name: place.name, pop: place.population },
      geometry: { type: 'Point', coordinates: [place.lon, place.lat] }
    }))
  };
}

/** The graticule's step by zoom, as a multiple of the world-fills-the-view zoom. */
export const GRATICULE_STEPS = [30, 10, 5, 1] as const;

/**
 * Every graticule line for every step, tagged `s` (its step in degrees); `s` 0 is the equator
 * and prime meridian, drawn heavier. The layers pick a step by zoom range, so nothing is
 * rebuilt while zooming. Latitudes start at -80 like the canvas version did.
 */
export function graticule(): FeatureCollection {
  const features: GeoFeature[] = [];
  const line = (s: number, a: [number, number], b: [number, number]) =>
    features.push({ type: 'Feature', properties: { s }, geometry: { type: 'LineString', coordinates: [a, b] } });
  for (const step of GRATICULE_STEPS) {
    for (let lat = -80; lat <= 80; lat += step) line(step, [-180, lat], [180, lat]);
    for (let lon = -180; lon < 180; lon += step) line(step, [lon, -MAX_LATITUDE], [lon, MAX_LATITUDE]);
  }
  line(0, [-180, 0], [180, 0]);
  line(0, [0, -MAX_LATITUDE], [0, MAX_LATITUDE]);
  return { type: 'FeatureCollection', features };
}

/** The dragged size-comparison outline, one multipolygon (holes preserved). */
export function outlineFeature(polygons: Ring[][]): GeoFeature<MultiPolygon> {
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polygons } };
}

export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
