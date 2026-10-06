/**
 * Vector tiles for the map: public/data/geography/world.pmtiles, a single PMTiles archive cut
 * from the full 1:10m payload (world.json) that scripts/build/build-content.mjs just wrote. Run as
 * the second step of `npm run build:content`; the output is committed like the rest of
 * public/data. The browser reads it with HTTP range requests (the `pmtiles` protocol for
 * MapLibre), so a static host with range support is all it needs — no tile server.
 *
 * Layers (all in the SAME unwrapped longitude frame the Feature records use — see
 * scripts/lib/geom.mjs; geojson-vt wraps what runs past +-180 for itself):
 *   countries  one multipolygon per country, property `iso3` (the feature id: promoteId)
 *   context    landmasses with no country record (Greenland, Western Sahara, ...)
 *   lakes      inland water missing from the polygons, drawn as ocean over the land
 *   halos      territory halos of island nations, property `iso3`
 *
 * Simplification is geojson-vt's per-zoom pass (tolerance in tile-extent units, so the error
 * stays ~one third of a pixel at every zoom), which is what makes world zoom light and high
 * zoom detailed from one source. Tiles stop at TILE_MAX_ZOOM; beyond it MapLibre overzooms,
 * which loses nothing because the source is quantised to ~1 km anyway.
 *
 *   node scripts/build/build-tiles.mjs
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import GeoJSONVT from 'geojson-vt';
import vtpbf from 'vt-pbf';

import { buildRing, decodeArcs, frameToReference, meanLon, nearestBranch, unwrapRing } from '../lib/geom.mjs';
import { writePmtiles } from '../lib/pmtiles-writer.mjs';

const dataDir = join('public', 'data', 'geography');
const TILE_MAX_ZOOM = 7;
const EXTENT = 4096;
const TOLERANCE = 2.5;
const BUFFER = 64;

const data = JSON.parse(readFileSync(join(dataDir, 'world.json'), 'utf8'));
const arcs = decodeArcs(data);
const countryById = new Map(data.countries.map(c => [c.id, c]));

/** Outer ring + holes, holes moved onto the outer ring's branch so a ring is never split. */
function polygonRings(indicesList) {
  const rings = indicesList.map(indices => unwrapRing(buildRing(indices, arcs))).filter(r => r.length > 2);
  if (!rings.length) return null;
  const reference = meanLon(rings[0]);
  return rings.map(closed).map((ring, i) => {
    if (i === 0) return ring;
    const shift = nearestBranch(meanLon(ring), reference) - meanLon(ring);
    return shift ? ring.map(([lon, lat]) => [lon + shift, lat]) : ring;
  });
}

const closed = ring => {
  const [a, b] = [ring[0], ring[ring.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
};

const polygonsOf = geometry =>
  (geometry.multi ? geometry.arcs : [geometry.arcs]).map(polygonRings).filter(Boolean);

const feature = (properties, polygons) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'MultiPolygon', coordinates: polygons }
});

const layers = { countries: [], context: [], lakes: [], halos: [] };

for (const geometry of data.geometries) {
  const country = countryById.get(geometry.id);
  const polygons = polygonsOf(geometry);
  if (!polygons.length) continue;
  if (!country) {
    layers.context.push(feature({}, polygons));
    continue;
  }
  layers.countries.push(feature({ iso3: country.iso3 }, frameToReference(polygons, country.latlng[1])));
}
for (const lake of data.lakes) {
  const rings = polygonRings(lake.arcs); // a lake's arcs are its rings (outer first)
  if (rings) layers.lakes.push(feature({}, [rings]));
}
for (const { id, ring } of data.halos) {
  const country = countryById.get(id);
  if (country && ring.length > 2) layers.halos.push(feature({ iso3: country.iso3 }, [[closed(ring)]]));
}

const indexes = Object.fromEntries(
  Object.entries(layers).map(([name, features]) => [
    name,
    new GeoJSONVT({ type: 'FeatureCollection', features }, {
      maxZoom: TILE_MAX_ZOOM, indexMaxZoom: TILE_MAX_ZOOM, indexMaxPoints: 0,
      tolerance: TOLERANCE, extent: EXTENT, buffer: BUFFER
    })
  ])
);

const tiles = [];
const perZoom = new Array(TILE_MAX_ZOOM + 1).fill(0);
const bytesPerZoom = new Array(TILE_MAX_ZOOM + 1).fill(0);
for (let z = 0; z <= TILE_MAX_ZOOM; z++) {
  const n = 1 << z;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      const present = {};
      for (const [name, index] of Object.entries(indexes)) {
        const tile = index.getTile(z, x, y);
        if (tile && tile.features.length) present[name] = tile;
      }
      if (!Object.keys(present).length) continue;
      const buffer = Buffer.from(vtpbf.fromGeojsonVt(present, { version: 2, extent: EXTENT }));
      tiles.push({ z, x, y, data: buffer });
      perZoom[z]++;
      bytesPerZoom[z] += buffer.length;
    }
  }
}

const archive = writePmtiles(tiles, {
  metadata: {
    name: 'zemya-world',
    format: 'pbf',
    attribution: 'Natural Earth (public domain) · country data mledoze/countries (ODbL)',
    vector_layers: Object.keys(layers).map(id => ({ id, fields: id === 'countries' || id === 'halos' ? { iso3: 'String' } : {} })),
    generator: 'scripts/build/build-tiles.mjs'
  },
  bounds: [-180, -85.0511, 180, 85.0511],
  minZoom: 0,
  maxZoom: TILE_MAX_ZOOM,
  center: { zoom: 1, lon: 0, lat: 20 }
});
const out = join(dataDir, 'world.pmtiles');
writeFileSync(out, archive);

console.log(`tiles          ${tiles.length} (z0-${TILE_MAX_ZOOM}), tolerance ${TOLERANCE}/${EXTENT}`);
console.log(`per zoom       ${perZoom.map((n, z) => `z${z}:${n}/${(bytesPerZoom[z] / 1024).toFixed(0)}KB`).join('  ')} (uncompressed)`);
console.log(`world.pmtiles  ${(statSync(out).size / 1024).toFixed(0)} KB`);
