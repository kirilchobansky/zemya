import { X0, Y0, XS, YS } from './config.mjs';
import { buildHalo, haloLonSpan, HALO_MAX_LON_SPAN, HALO_MAX_NEIGHBOUR_SHARE, neighbourLandShare, qualifiesForHalo, unwrappedVertices } from '../../lib/halo.mjs';

/**
 * Territory halos (scripts/lib/halo.mjs): a rounded area round every island nation —
 * no land borders AND under 25,000 km2, derived here, not listed. Built from the FULL
 * geometry and emitted identically in both payloads (the coarse one paints first).
 * Throws rather than skipping: a qualifying country with no halo, or one wider than 60
 * degrees of longitude once unwrapped (the antimeridian handling failed), is a bug.
 */
export function buildHalos(countries, full) {
  const halos = [];
  const haloOverNeighbour = []; // qualifying by size, a dot because the wash would paint a neighbour
  {
    const { x0, y0, xs, ys } = { x0: X0, y0: Y0, xs: XS, ys: YS };
    const decoded = full.arcs.map(arc => {
      let x = 0, y = 0;
      return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * xs + x0, y * ys + y0]; });
    });
    const stitch = indices => {
      let points = [];
      for (const index of indices) {
        const reversed = index < 0;
        const arc = decoded[reversed ? ~index : index];
        const segment = reversed ? arc.slice().reverse() : arc;
        points = points.length ? points.concat(segment.slice(1)) : segment.slice();
      }
      return points;
    };
    const geometryById = new Map(full.geometries.map(g => [g.id, g]));
    /* every polygon's outer ring with its box, for the neighbour-land share below */
    const landPolygons = [];
    for (const g of full.geometries) {
      for (const polygon of g.multi ? g.arcs : [g.arcs]) {
        const ring = stitch(polygon[0]);
        let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
        for (const [lon, lat] of ring) { a = Math.min(a, lon); c = Math.max(c, lon); b = Math.min(b, lat); d = Math.max(d, lat); }
        landPolygons.push({ id: g.id, ring, bbox: [a, b, c, d] });
      }
    }
    for (const country of countries) {
      if (!qualifiesForHalo(country)) continue;
      const geometry = geometryById.get(country.id);
      if (!geometry) throw new Error(`halo: ${country.iso3} qualifies but has no geometry`);
      const polygonList = geometry.multi ? geometry.arcs : [geometry.arcs];
      const polygons = polygonList.map(polygon => polygon.map(stitch));
      const ring = buildHalo(unwrappedVertices(polygons, country.latlng[1]));
      if (!ring || ring.length < 3) throw new Error(`halo: ${country.iso3} qualifies but produced no halo`);
      const span = haloLonSpan(ring);
      if (span > HALO_MAX_LON_SPAN) {
        throw new Error(`halo: ${country.iso3} spans ${span.toFixed(1)} degrees of longitude — antimeridian unwrapping failed`);
      }
      if (neighbourLandShare(ring, landPolygons.filter(p => p.id !== country.id)) > HALO_MAX_NEIGHBOUR_SHARE) {
        haloOverNeighbour.push(country.iso3);
        continue;
      }
      halos.push({ id: country.id, ring });
    }
  }
  return { halos, haloOverNeighbour };
}
