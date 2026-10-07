import { mergeArcs } from 'topojson-client';
import * as simplify from 'topojson-simplify';
import { slugify } from '../../lib/slug.mjs';
import { require, SYNTHETIC_IDS, ABSORB, DROP_GEOMETRY, X0, Y0, XS, YS } from './config.mjs';
import { buildLakes } from './lakes.mjs';

/**
 * A geometry's arcs, normalised to "list of polygons" (each polygon a list of rings)
 * regardless of whether the source called it Polygon or MultiPolygon — so absorbing one
 * into another is just concatenating two such lists.
 */
function polygonsOf(g) {
  return g.type === 'MultiPolygon' ? g.arcs : [g.arcs];
}

/**
 * Real numeric ids pass straight through unchanged. A geometry with no id (Kosovo, or
 * anything left in the "drawn dim" bucket after ABSORB) falls back to SYNTHETIC_IDS,
 * then to a slug of its own Natural Earth name — stable and unique, never the "NaN"
 * every id-less geometry used to collide on.
 */
function geometryId(g) {
  if (g.id !== undefined && g.id !== null && g.id !== '') return String(Number(g.id));
  const name = g.properties?.name;
  return SYNTHETIC_IDS[name] ?? (name ? `x-${slugify(name)}` : String(Number(g.id)));
}

/** Same underlying arcs, regardless of direction — a hole ring and the polygon that
 *  exactly fills it reference identical arcs with opposite winding (one forward, one
 *  reversed), never the same signs. */
function arcKey(ring) {
  return ring.map(i => (i < 0 ? ~i : i)).sort((a, b) => a - b).join(',');
}
/**
 * Builds one detail level's arcs/geometries/lakes, always from a FRESH clone of the
 * upstream Natural Earth data. topojson-simplify's simplify()+filter() permanently drops
 * points, so simplifying an already-simplified topology to a coarser threshold is not the
 * same as simplifying the original once at that threshold directly — two independent
 * calls (one at DETAIL, one at COARSE_DETAIL below) is what emitting "two full detail
 * levels" actually requires, not one call feeding the next.
 */
export function buildGeometry(countries, detail) {
    let topo = JSON.parse(JSON.stringify(require('world-atlas/countries-10m.json')));

    for (const name of Object.keys(SYNTHETIC_IDS)) {
      const exists = topo.objects.countries.geometries.some(g => g.properties?.name === name);
      if (!exists) throw new Error(`SYNTHETIC_IDS: no geometry named "${name}" in the source data — renamed upstream?`);
    }
    for (const [name, targetIso3] of Object.entries(ABSORB)) {
      const exists = topo.objects.countries.geometries.some(g => g.properties?.name === name);
      if (!exists) throw new Error(`ABSORB: no geometry named "${name}" in the source data — renamed upstream?`);
      if (!countries.some(c => c.iso3 === targetIso3)) {
        throw new Error(`ABSORB: target ISO3 "${targetIso3}" for "${name}" is not in the catalogue`);
      }
    }

    topo.objects.countries.geometries = topo.objects.countries.geometries.filter(
      g => !DROP_GEOMETRY.has(String(Number(g.id)))
    );
    if (detail > 0) {
      topo = simplify.presimplify(topo);
      topo = simplify.simplify(topo, detail);
      topo = simplify.filter(topo, simplify.filterAttachedWeight(topo, detail));
    }

    // presimplify dequantises; arcs come back as absolute lon/lat with no transform
    const absolute = topo.transform
      ? topo.arcs.map(arc => {
          let x = 0, y = 0;
          return arc.map(([dx, dy]) => {
            x += dx; y += dy;
            return [x * topo.transform.scale[0] + topo.transform.translate[0],
                    y * topo.transform.scale[1] + topo.transform.translate[1]];
          });
        })
      : topo.arcs.map(arc => arc.map(p => [p[0], p[1]]));

    const arcs = absolute.map(arc => {
      let px = 0, py = 0;
      const out = [];
      for (const [lon, lat] of arc) {
        const x = Math.round((lon - X0) / XS);
        const y = Math.round((lat - Y0) / YS);
        const dx = x - px, dy = y - py;
        px = x; py = y;
        if (out.length && dx === 0 && dy === 0) continue;   // drop repeated vertices
        out.push([dx, dy]);
      }
      if (out.length < 2) out.push([0, 0]);
      return out;
    });

    // mergeArcs() only reads the arc pool (and transform, if any) to stitch rings
    const topoForMerge = topo;
    const absorbedPolygons = new Map(); // target iso3 -> polygons to append
    const built = []; // { id, multi, arcs, polygons } — polygons kept alongside for merging

    for (const g of topo.objects.countries.geometries) {
      const name = g.properties?.name;
      if (name && ABSORB[name]) {
        const list = absorbedPolygons.get(ABSORB[name]) ?? [];
        list.push(...polygonsOf(g));
        absorbedPolygons.set(ABSORB[name], list);
        continue;
      }
      const polygons = polygonsOf(g);
      built.push({ id: geometryId(g), multi: g.type === 'MultiPolygon', arcs: g.arcs, polygons });
    }

    for (const [targetIso3, extra] of absorbedPolygons) {
      const targetId = countries.find(c => c.iso3 === targetIso3).id;
      const entry = built.find(b => b.id === targetId);
      if (!entry) {
        // the target had no geometry of its own to merge into — not the case for any
        // current ABSORB entry, but a new one shouldn't silently lose its territory
        built.push({ id: targetId, multi: extra.length > 1, arcs: extra.length > 1 ? extra : extra[0], polygons: extra });
        continue;
      }

      /**
       * Dissolve the shared borders instead of stacking polygons. Somaliland sits beside
       * Somalia, and Northern Cyprus, the buffer zone and the British bases sit beside the
       * rest of Cyprus: each pair of neighbours references the SAME arcs (one forward, one
       * reversed), so appending the absorbed polygon as a separate one left both rings in
       * place, and the stroke pass drew the old border straight through what is now one
       * country. topojson-client's mergeArcs() drops every arc that two polygons share and
       * stitches what's left into one outline. That also covers Baikonur, which is a hole
       * in Kazakhstan that its own polygon exactly re-fills — the pair cancels completely.
       * Arcs left unused by this simply stay in the pool, unreferenced.
       */
      const merged = mergeArcs(topoForMerge, [{ type: 'MultiPolygon', arcs: [...entry.polygons, ...extra] }]).arcs;
      entry.polygons = merged;
      entry.multi = merged.length > 1;
      entry.arcs = merged.length > 1 ? merged : merged[0];
    }

    const geometries = built.map(({ id, multi, arcs }) => ({ id, multi, arcs }));

  const lakes = buildLakes(arcs, detail);

  const totalPoints = arcs.reduce((sum, arc) => sum + arc.length, 0);
  return { arcs, geometries, lakes, totalPoints };
}
