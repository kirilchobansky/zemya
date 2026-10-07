import * as simplify from 'topojson-simplify';
import { require, X0, Y0, XS, YS } from './config.mjs';

/** The Caspian Sea (the one hole in world-atlas's land layer) as lake geometries; its arcs are
 *  appended to `arcs`, re-quantised onto the same grid. */
export function buildLakes(arcs, detail) {
    let land = JSON.parse(JSON.stringify(require('world-atlas/land-10m.json')));
    if (detail > 0) {
      land = simplify.presimplify(land);
      land = simplify.simplify(land, detail);
      land = simplify.filter(land, simplify.filterAttachedWeight(land, detail));
    }

    const landAbsolute = land.transform
      ? land.arcs.map(arc => {
          let x = 0, y = 0;
          return arc.map(([dx, dy]) => {
            x += dx; y += dy;
            return [x * land.transform.scale[0] + land.transform.translate[0],
                    y * land.transform.scale[1] + land.transform.translate[1]];
          });
        })
      : land.arcs.map(arc => arc.map(p => [p[0], p[1]]));

    /** Stitch a ring's arc indices into absolute lon/lat points — same logic as
     *  topology.ts's buildRing, but at build time and against land-10m's own arc pool. */
    function stitchRing(indices) {
      let points = [];
      for (const index of indices) {
        const reversed = index < 0;
        const arc = landAbsolute[reversed ? ~index : index];
        const segment = reversed ? arc.slice().reverse() : arc;
        points = points.length ? points.concat(segment.slice(1)) : segment.slice();
      }
      return points;
    }

    /** Re-quantise already-absolute lon/lat points onto this file's own grid — the same
     *  transform the main arcs went through, just run on one extra ring instead of the
     *  whole arc pool. */
    function requantise(points) {
      let px = 0, py = 0;
      const out = [];
      for (const [lon, lat] of points) {
        const x = Math.round((lon - X0) / XS);
        const y = Math.round((lat - Y0) / YS);
        const dx = x - px, dy = y - py;
        px = x; py = y;
        if (out.length && dx === 0 && dy === 0) continue;
        out.push([dx, dy]);
      }
      if (out.length < 2) out.push([0, 0]);
      return out;
    }

    // every ring after a polygon's first is a hole
    const holes = land.objects.land.geometries.flatMap(g => {
      const polygons = g.type === 'MultiPolygon' ? g.arcs : [g.arcs];
      return polygons.flatMap(rings => rings.slice(1));
    });
    if (!holes.length) {
      throw new Error(
        "lakes: expected at least one hole in world-atlas's land layer (the Caspian Sea) — did the upstream data change?"
      );
    }

    const lakes = holes.map((indices, i) => {
      const points = stitchRing(indices);
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const [lon, lat] of points) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      // this only ever expected to find the Caspian — if a future Natural Earth release
      // punches a second hole somewhere else, that needs a deliberate decision, not a
      // silent new water body
      const looksLikeCaspian = minLon > 40 && maxLon < 60 && minLat > 30 && maxLat < 50;
      if (!looksLikeCaspian) {
        throw new Error(
          `lakes: a hole in the land layer no longer matches the Caspian Sea's expected bounds ` +
            `(got lon ${minLon.toFixed(1)}..${maxLon.toFixed(1)}, lat ${minLat.toFixed(1)}..${maxLat.toFixed(1)}) — ` +
            'investigate before shipping; do not just widen this check'
        );
      }
      const arcIndex = arcs.length;
      arcs.push(requantise(points));
      return { id: i === 0 ? 'lake-caspian-sea' : `lake-caspian-sea-${i}`, arcs: [[arcIndex]] };
    });

  return lakes;
}
