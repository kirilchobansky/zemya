/** Constants and paths shared by every module of the content pipeline (build-content.mjs). */
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const require = createRequire(import.meta.url);
export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const DETAIL = Number(
  (process.argv.find(a => a.startsWith('--detail=')) || '').split('=')[1] || 0
);
/** Antarctica, by ISO numeric. Dropped: it eats a third of a Mercator viewport and no
 *  study mode ever refers to it. */
export const DROP_GEOMETRY = new Set(['10']);
/**
 * Entities with no ISO 3166-1 numeric code — world-countries gives Kosovo ccn3 "" and
 * Natural Earth's geometry has id undefined, only properties.name === "Kosovo" — so the
 * usual ccn3-based join drops them from both sides. Mapped by common name, which both
 * upstream datasets happen to share, onto one synthetic id used for both the country
 * record and its geometry. A no-id geometry with no entry here (Somaliland, N. Cyprus,
 * Siachen Glacier, ...) falls through unmatched to the existing "drawn dim, never
 * clickable" path, which is correct for all of them.
 */
export const SYNTHETIC_IDS = { Kosovo: 'x-kosovo' };
/**
 * Some Natural Earth geometries are real territory that Zemya draws as part of a
 * different country's shape, rather than as their own dim, unclickable blob: a
 * Russian-leased cosmodrome, UK sovereign base areas, land whose only international
 * recognition is from the country it borders. Each entry says why, in the same spirit
 * as the content override notes. Merging happens at the geometry level — the absorbed
 * polygon(s) are appended to the target's own geometry (promoting Polygon to
 * MultiPolygon where needed) — and the absorbed name is never emitted as a geometry of
 * its own. Everything NOT listed here keeps the existing "drawn dim, never clickable"
 * behaviour, which is correct for Greenland, Puerto Rico, Hong Kong, Macau, Western
 * Sahara, the Falklands, the Spratlys, Clipperton and the rest — do not add to this map
 * casually, it is a claim about whose territory something is.
 */
export const ABSORB = {
  Somaliland: 'SOM',              // de facto self-governing, but recognised by no state;
                                   // Zemya draws Somalia's internationally recognised territory
  Baikonur: 'KAZ',                 // Russian-leased cosmodrome; Kazakh territory
  'N. Cyprus': 'CYP',              // recognised only by Türkiye
  'Cyprus U.N. Buffer Zone': 'CYP',
  Akrotiri: 'CYP',                 // UK sovereign base area, drawn as part of the island
  Dhekelia: 'CYP',
  'USNB Guantanamo Bay': 'CUB',    // US-leased; Cuban territory
  'Siachen Glacier': 'IND'         // India-administered; disputed with Pakistan
};
/** Integer grid the arcs are re-quantised onto. 32768 keeps sub-kilometre precision at
 *  1:10m while halving the byte cost of the coordinate stream. */
export const QUANT = 32768;

/** ~48,600 points, ~645 KB — see CLAUDE.md's Performance section for the measured
 *  detail/frame-time table this value was picked from. Hardcoded, not overridable by
 *  --detail: that flag is for testing the FULL payload at a different resolution (see
 *  this file's own header comment), and always applies to `full` below. */
export const COARSE_DETAIL = 0.006;

/** The integer grid's origin and step, derived from QUANT. */
export const X0 = -180, Y0 = -90, XS = 360 / (QUANT - 1), YS = 180 / (QUANT - 1);
