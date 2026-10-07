import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, DETAIL, QUANT, COARSE_DETAIL, X0, Y0, XS, YS } from './config.mjs';

/** Writes world.json, world-coarse.json, countries.json and slugs.json under public/data/geography. */
export function writeData({ full, coarse, places, halos, countries }) {
  const withGeometry = new Set(full.geometries.map(g => g.id));
  const noPolygon = countries.filter(c => !withGeometry.has(c.id)).map(c => c.iso3);

  const outDir = join(root, 'public', 'data', 'geography');
  mkdirSync(outDir, { recursive: true });

  const payload = {
    version: 1,
    generated: { detail: DETAIL, quantisation: QUANT },
    grid: { x0: X0, y0: Y0, xs: XS, ys: YS },
    arcs: full.arcs,
    geometries: full.geometries,
    lakes: full.lakes,
    places,
    halos,
    countries
  };
  const json = JSON.stringify(payload);
  writeFileSync(join(outDir, 'world.json'), json, 'utf8');

  /**
   * The reduced-detail counterpart the map loads first (see app/features/countries/world.ts) —
   * geometry only. Country records, borders, names and everything else non-geometric stay
   * in world.json alone; this file is never a second source of truth for them. Lakes ARE
   * included here despite being their own top-level field rather than part of
   * `geometries`, deliberately: leaving them out would show the Caspian Sea as solid land
   * at world zoom (exactly the tier this file is drawn at) until the full payload finished
   * loading, regressing a "Working" feature — see CLAUDE.md's Where this is.
   */
  const coarsePayload = {
    version: 1,
    generated: { detail: COARSE_DETAIL, quantisation: QUANT },
    grid: { x0: X0, y0: Y0, xs: XS, ys: YS },
    arcs: coarse.arcs,
    geometries: coarse.geometries,
    lakes: coarse.lakes,
    places,
    halos
  };
  const coarseJson = JSON.stringify(coarsePayload);
  writeFileSync(join(outDir, 'world-coarse.json'), coarseJson, 'utf8');

  // facts without geometry: what route loaders read at build time, so a country page's
  // HTML is complete before the map payload has even started downloading — and what the
  // client fetches alongside world-coarse.json for the map's own first paint.
  const facts = JSON.stringify(countries);
  writeFileSync(join(outDir, 'countries.json'), facts, 'utf8');

  // the slug list the router prerenders from
  writeFileSync(
    join(outDir, 'slugs.json'),
    JSON.stringify(countries.map(c => c.slug).sort()),
    'utf8'
  );

  return { json, coarseJson, facts, noPolygon };
}
