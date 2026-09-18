/**
 * Content pipeline: content/geography/** -> public/data/geography/{world,world-coarse,
 * countries,slugs}.json
 *
 * Joins hand-authored YAML against two upstream datasets and emits the payloads the app
 * fetches at runtime. The output is committed so a deploy can never break because an
 * upstream package published a new version.
 *
 *   node scripts/build-content.mjs [--detail=0.02]
 *
 * Emits TWO geometry payloads, always: world.json at DETAIL (below; default 0, full
 * 1:10m, unsimplified) and world-coarse.json at a hardcoded COARSE_DETAIL (0.006) the map
 * renders from at world zoom, where full detail is sub-pixel — see CLAUDE.md's Performance
 * section for the measured detail/frame-time table this is based on, and
 * app/lib/geography/world.ts / app/lib/map/topology.ts's attachFullDetail for how the two
 * are loaded and switched between at runtime. --detail only ever affects world.json,
 * which is what makes it useful for testing a specific "full" resolution (as the
 * Performance section's table did) without touching the coarse tier at all.
 */
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync,
  statSync, existsSync
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
import * as simplify from 'topojson-simplify';
import { slugFor, slugify } from './lib/slug.mjs';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const DETAIL = Number(
  (process.argv.find(a => a.startsWith('--detail=')) || '').split('=')[1] || 0
);
/** Antarctica, by ISO numeric. Dropped: it eats a third of a Mercator viewport and no
 *  study mode ever refers to it. */
const DROP_GEOMETRY = new Set(['10']);
/**
 * Entities with no ISO 3166-1 numeric code — world-countries gives Kosovo ccn3 "" and
 * Natural Earth's geometry has id undefined, only properties.name === "Kosovo" — so the
 * usual ccn3-based join drops them from both sides. Mapped by common name, which both
 * upstream datasets happen to share, onto one synthetic id used for both the country
 * record and its geometry. A no-id geometry with no entry here (Somaliland, N. Cyprus,
 * Siachen Glacier, ...) falls through unmatched to the existing "drawn dim, never
 * clickable" path, which is correct for all of them.
 */
const SYNTHETIC_IDS = { Kosovo: 'x-kosovo' };
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
const ABSORB = {
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
const QUANT = 32768;

/* ------------------------------------------------------------------ authored content */

const dir = join(root, 'content', 'geography', 'countries');
const authored = {};
const slugs = new Set();

for (const file of readdirSync(dir).filter(f => f.endsWith('.yaml'))) {
  const doc = parse(readFileSync(join(dir, file), 'utf8'));
  const where = `content/geography/countries/${file}`;
  for (const field of ['iso3', 'slug', 'name', 'religion', 'flag', 'outline', 'hook']) {
    if (!doc?.[field]) throw new Error(`${where}: missing required field "${field}"`);
  }
  if (`${doc.slug}.yaml` !== file) throw new Error(`${where}: slug "${doc.slug}" does not match filename`);
  if (slugs.has(doc.slug)) throw new Error(`${where}: duplicate slug "${doc.slug}"`);
  if (authored[doc.iso3]) throw new Error(`${where}: duplicate iso3 "${doc.iso3}"`);
  slugs.add(doc.slug);
  authored[doc.iso3] = doc;
}

/* ------------------------------------------------------------------- upstream joins */

const wc = require('world-countries');
const popFallback = Object.fromEntries(
  require('country-json/src/country-by-population.json').map(r => [r.country, r.population])
);

const LANG_FAMILIES = {
  'Indo-European': ['English', 'Spanish', 'Portuguese', 'French', 'Italian', 'German', 'Dutch', 'Russian', 'Ukrainian', 'Belarusian', 'Polish', 'Czech', 'Slovak', 'Slovene', 'Croatian', 'Serbian', 'Bosnian', 'Bulgarian', 'Macedonian', 'Montenegrin', 'Romanian', 'Moldovan', 'Greek', 'Albanian', 'Armenian', 'Persian', 'Pashto', 'Dari', 'Urdu', 'Hindi', 'Bengali', 'Nepali', 'Sinhala', 'Punjabi', 'Marathi', 'Kurdish', 'Tajik', 'Danish', 'Swedish', 'Norwegian', 'Norwegian Bokmål', 'Norwegian Nynorsk', 'Icelandic', 'Faroese', 'Latvian', 'Lithuanian', 'Irish', 'Welsh', 'Scottish Gaelic', 'Luxembourgish', 'Catalan', 'Romansh', 'Afrikaans', 'Dhivehi', 'Hindustani', 'Papiamento', 'Sranan Tongo', 'Haitian Creole', 'Balochi', 'Ossetian', 'Serbo-Croatian', 'Portuguese Creole'],
  'Afro-Asiatic': ['Arabic', 'Hebrew', 'Amharic', 'Tigrinya', 'Somali', 'Berber', 'Maltese', 'Hausa', 'Oromo'],
  'Sino-Tibetan': ['Chinese', 'Mandarin', 'Burmese', 'Dzongkha', 'Tibetan'],
  'Niger-Congo': ['Swahili', 'Zulu', 'Xhosa', 'Shona', 'Kinyarwanda', 'Kirundi', 'Lingala', 'Kikongo', 'Tswana', 'Sotho', 'Southern Sotho', 'Northern Sotho', 'Chewa', 'Chichewa', 'Sango', 'Kikuyu', 'Wolof', 'Fula', 'Yoruba', 'Igbo', 'Comorian', 'Swati', 'Ndebele', 'Tsonga', 'Venda', 'Tumbuka', 'Umbundu', 'Kongo', 'Luba-Katanga'],
  'Austronesian': ['Indonesian', 'Malay', 'Filipino', 'Tagalog', 'Javanese', 'Fijian', 'Samoan', 'Tongan', 'Māori', 'Malagasy', 'Marshallese', 'Nauru', 'Palauan', 'Chamorro', 'Tetum', 'Hiri Motu', 'Gilbertese', 'Tok Pisin', 'Bislama'],
  'Turkic': ['Turkish', 'Azerbaijani', 'Kazakh', 'Uzbek', 'Kyrgyz', 'Turkmen', 'Tatar'],
  'Austroasiatic': ['Vietnamese', 'Khmer'],
  'Tai-Kadai': ['Thai', 'Lao'],
  'Japonic / Koreanic': ['Japanese', 'Korean'],
  'Uralic': ['Finnish', 'Estonian', 'Hungarian'],
  'Other families': ['Georgian', 'Basque', 'Quechua', 'Aymara', 'Guaraní', 'Greenlandic', 'Mongolian', 'Nauruan', 'Papuan', 'Creole', 'Seychellois Creole', 'Mauritian Creole', 'French Creole']
};
const familyOf = (() => {
  const m = {};
  for (const fam of Object.keys(LANG_FAMILIES)) for (const l of LANG_FAMILIES[fam]) if (!(l in m)) m[l] = fam;
  return lang => m[lang] || 'Other families';
})();

/** Coarse grouping used only for the choropleth legend. The specific value authored in
 *  the YAML is what the dossier and the quizzes use. */
function religionGroup(r) {
  if (/Islam/i.test(r)) return 'Islam';
  if (/Judaism/i.test(r)) return 'Judaism';
  if (/Hindu/i.test(r)) return 'Hinduism';
  if (/Buddh/i.test(r)) return 'Buddhism';
  if (/Christian|Catholic|Protest|Orthodox|Anglican/i.test(r)) return 'Christianity';
  if (/Shinto|folk|Vodun|Vodou|ancestor|traditional/i.test(r)) return 'Folk / traditional';
  if (/Athe|no religion|Juche|Secular/i.test(r)) return 'Secular / none';
  return 'Other';
}

/**
 * `override:` in a country's YAML closes a gap in the upstream dataset — see e.g.
 * micronesia.yaml, where world-countries ships `currencies: {}` for FSM even though the
 * Compact of Free Association makes the US dollar sole legal tender. A shallow merge onto
 * the built record, validated so a typo or an unjustified override fails the build rather
 * than silently doing nothing or drifting unnoticed. See CLAUDE.md's Content conventions
 * for what an override is (and is not) for.
 */
const overriddenFields = [];
function applyOverride(record, a, where) {
  if (!a.override) return record;
  const { note, ...fields } = a.override;
  if (!note || !String(note).trim()) {
    throw new Error(`${where}: override block needs a non-empty "note" explaining why upstream is wrong`);
  }
  for (const key of Object.keys(fields)) {
    if (!(key in record)) {
      throw new Error(`${where}: override key "${key}" is not a field on the country record`);
    }
    record[key] = fields[key];
    overriddenFields.push(`${record.iso3}.${key}`);
  }
  return record;
}

/** Mirrors app/lib/geography/mastery.ts's FACETS. Kept as a separate literal because this
 *  build script runs as plain Node and can't import a .ts module through the `~` alias —
 *  if you add a facet there, add it here too. */
const FACETS = ['location', 'capital', 'flag', 'currency', 'language', 'religion', 'borders', 'outline'];

/**
 * `disputed:` in a country's YAML marks a facet as genuinely contested rather than picking
 * a source and asserting precision nobody has (see Nigeria's religion — CLAUDE.md's
 * Content conventions). Same validation shape as override: a non-empty reason is
 * mandatory, and the facet name must be real. The effect lives in
 * app/lib/geography/mastery.ts (applicableFacets excludes it) and questions.ts (never
 * generates a question from it) — this function only records it onto the record.
 */
const disputedFacets = [];
function applyDisputed(record, a, where) {
  if (!a.disputed) return record;
  for (const [facet, reason] of Object.entries(a.disputed)) {
    if (!FACETS.includes(facet)) {
      throw new Error(`${where}: disputed key "${facet}" is not a recognised facet`);
    }
    if (!reason || !String(reason).trim()) {
      throw new Error(`${where}: disputed.${facet} needs a non-empty reason`);
    }
    record.disputed[facet] = String(reason).trim();
    disputedFacets.push(`${record.iso3}.${facet}`);
  }
  return record;
}

const countries = [];
for (const c of wc) {
  const a = authored[c.cca3];
  if (!a) continue;
  const languages = Object.values(c.languages || {});
  const currencyCode = Object.keys(c.currencies || {})[0] || null;
  const currency = currencyCode ? c.currencies[currencyCode] : null;
  const population = a.population ?? popFallback[c.name.common] ?? 0;
  const record = {
    id: SYNTHETIC_IDS[c.name.common] ?? String(Number(c.ccn3)),
    iso3: c.cca3,
    iso2: c.cca2,
    slug: a.slug,
    name: c.name.common,
    officialName: c.name.official,
    emoji: c.flag,
    capital: (c.capital && c.capital[0]) || null,
    currencyCode,
    currencyName: currency?.name ?? null,
    currencySymbol: currency?.symbol ?? '',
    population,
    area: c.area,
    density: c.area ? population / c.area : 0,
    languages,
    language: languages[0] ?? null,
    languageFamily: familyOf(languages[0]),
    religion: a.religion,
    religionGroup: religionGroup(a.religion),
    borders: (c.borders || []).filter(b => authored[b]),
    landlocked: !!c.landlocked,
    latlng: c.latlng,
    region: c.region,
    subregion: c.subregion,
    hook: a.hook,
    flagDescription: a.flag,
    outlineDescription: a.outline,
    disputed: {}
  };
  const where = `content/geography/countries/${a.slug}.yaml`;
  countries.push(applyDisputed(applyOverride(record, a, where), a, where));
}

const missing = Object.keys(authored).filter(iso3 => !countries.some(c => c.iso3 === iso3));
if (missing.length) throw new Error(`authored countries with no ISO record: ${missing.join(', ')}`);

/* ------------------------------------------------------------------------- aliases */

/**
 * Every string a user could reasonably type to name a country in the "Name the Country"
 * quiz, sourced from world-countries' altSpellings plus its own common and official name
 * — it already covers the hard cases (Burma/Myanmar, Swaziland/Eswatini, East Timor/
 * Timor-Leste, Holland/Netherlands, DRC, UAE, Ivory Coast/Côte d'Ivoire, Macedonia)
 * without hand-writing a list from memory. Two-letter ISO codes are dropped — they are
 * not names and they collide ("US", "GB", "CI") — non-Latin spellings are kept for free.
 * Matching itself (case, diacritics, punctuation) lives in app/lib/geography/names.ts;
 * this only decides the candidate set and guards against ambiguity, since a normalised
 * alias that maps to two different countries must never resolve to whichever one was
 * parsed first.
 */
/** Mirrors app/lib/geography/names.ts's normaliseName() — kept in sync deliberately, the
 *  same way build-content.mjs's FACETS mirrors mastery.ts's, because this build script
 *  runs as plain Node and can't import a .ts module through the `~` alias. Unicode
 *  `\p{L}`/`\p{N}` matters here too: an ASCII a-z0-9 range would treat Armenian or
 *  Cyrillic aliases as pure punctuation and normalise every one of them to "", which
 *  would make every non-Latin alias in the catalogue collide with every other one. */
function normaliseAlias(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’‘ʼ`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const aliasSources = new Map(); // iso3 -> raw alias strings, deduped, before the collision check
for (const c of wc) {
  if (!authored[c.cca3]) continue;
  const raw = [...(c.altSpellings || []), c.name.common, c.name.official];
  aliasSources.set(c.cca3, [...new Set(raw.filter(s => s && s.trim().length > 2))]);
}

// normalised alias -> every iso3 that claims it, across the whole catalogue
const claimedBy = new Map();
for (const [iso3, aliases] of aliasSources) {
  for (const alias of aliases) {
    const key = normaliseAlias(alias);
    if (!key) continue;
    if (!claimedBy.has(key)) claimedBy.set(key, new Set());
    claimedBy.get(key).add(iso3);
  }
}
// ambiguous means two DIFFERENT countries claim the same normalised form — the same
// country listing a spelling twice (common name === an altSpelling) does not count
const ambiguous = [...claimedBy.entries()].filter(([, isos]) => isos.size > 1);
const ambiguousKeys = new Set(ambiguous.map(([key]) => key));

let totalAliases = 0;
let droppedAliases = 0;
for (const country of countries) {
  const kept = [];
  for (const alias of aliasSources.get(country.iso3) ?? []) {
    if (ambiguousKeys.has(normaliseAlias(alias))) {
      droppedAliases += 1;
      continue;
    }
    kept.push(alias);
  }
  country.aliases = kept;
  totalAliases += kept.length;
}

/* ------------------------------------------------------------------ confusable flags */

/**
 * A small curated list (content/geography/confusable-flags.yaml) of flag pairs the "Name
 * the Flag" quiz accepts for each other, with a factual note on the real difference — see
 * that file's own header comment and CLAUDE.md's Quizzes section for why this exists and
 * why it stays hand-curated rather than generated. Each side gets the OTHER country's
 * already-computed aliases embedded directly (denormalised), so
 * app/lib/geography/quizzes.ts's matcher can accept "that one was the twin" without a
 * second lookup into the full catalogue at match time.
 */
const confusableFlagsPath = join(root, 'content', 'geography', 'confusable-flags.yaml');
const confusableDoc = parse(readFileSync(confusableFlagsPath, 'utf8')) ?? {};
const countryByName = new Map(countries.map(c => [c.name, c]));
let confusablePairCount = 0;
for (const pair of confusableDoc.pairs ?? []) {
  const where = 'content/geography/confusable-flags.yaml';
  if (!Array.isArray(pair.countries) || pair.countries.length !== 2) {
    throw new Error(`${where}: each pair needs exactly two "countries"`);
  }
  if (!pair.note || !String(pair.note).trim()) {
    throw new Error(`${where}: pair "${pair.countries.join(' / ')}" needs a non-empty "note"`);
  }
  const [nameA, nameB] = pair.countries;
  const a = countryByName.get(nameA);
  const b = countryByName.get(nameB);
  if (!a) throw new Error(`${where}: "${nameA}" is not a known country name`);
  if (!b) throw new Error(`${where}: "${nameB}" is not a known country name`);
  const note = String(pair.note).trim();
  a.confusableFlag = { iso3: b.iso3, aliases: b.aliases, note };
  b.confusableFlag = { iso3: a.iso3, aliases: a.aliases, note };
  confusablePairCount += 1;
}

/* ---------------------------------------------------------------------- geometry */

const X0 = -180, Y0 = -90, XS = 360 / (QUANT - 1), YS = 180 / (QUANT - 1);

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
function buildGeometry(detail) {
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
     * Baikonur is cut out of Kazakhstan's own polygon as a hole, and Baikonur's polygon
     * exactly re-fills that same hole (confirmed: both reference arc 903, one forward as
     * the hole, one reversed as Baikonur's outer ring). Appending Baikonur as a NEW
     * polygon on top of an unmodified Kazakhstan would leave both rings in place —
     * invisible in the fill (same colour, so no visible seam there) but both still get
     * traced in the stroke pass, drawing a circle where there should be seamless
     * one-colour territory. Cancel the pair instead of stacking them: remove the
     * target's hole, skip adding the absorbed polygon. Anything that ISN'T a hole-fill
     * (Somaliland is a genuinely separate adjacent landmass, not a hole in Somalia)
     * still gets appended as before.
     */
    const remaining = [];
    for (const polygon of extra) {
      const outerKey = arcKey(polygon[0]);
      const targetPolygon = entry.polygons.find(p => p.slice(1).some(hole => arcKey(hole) === outerKey));
      if (targetPolygon) {
        const holeIndex = targetPolygon.findIndex((ring, i) => i > 0 && arcKey(ring) === outerKey);
        targetPolygon.splice(holeIndex, 1);
      } else {
        remaining.push(polygon);
      }
    }

    const merged = [...entry.polygons, ...remaining];
    entry.polygons = merged;
    entry.multi = merged.length > 1;
    entry.arcs = merged.length > 1 ? merged : merged[0];
  }

  const geometries = built.map(({ id, multi, arcs }) => ({ id, multi, arcs }));

  /* ------------------------------------------------------------------------- lakes */

  /**
   * world-atlas ships no lakes layer. Investigated fetching Natural Earth's ne_10m_lakes
   * directly (a 2.3 MB shapefile covering thousands of lakes worldwide) and decided
   * against it for now — filtering it down to the handful of lakes worth drawing would
   * need either a new dependency to parse a Shapefile or a hand-rolled binary parser,
   * plus a build-time network fetch this project has never had. Punted; see CLAUDE.md's
   * Where this is.
   *
   * What's free: world-atlas's separate land-10m.json land polygon already excludes the
   * Caspian Sea as a hole — the one polygon-with-holes in that entire dataset, confirmed
   * by its bounding box (46-55°E, 36-47°N, exactly the Caspian's real extent). Extracted
   * here and re-encoded into this file's own arc pool — no new dependency, no network
   * call, just reading a file already installed for a different purpose. The Great
   * Lakes, Lake Victoria and Lake Baikal are not holes in any world-atlas layer and are
   * not included.
   */
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

  const totalPoints = arcs.reduce((sum, arc) => sum + arc.length, 0);
  return { arcs, geometries, lakes, totalPoints };
}

/** ~48,600 points, ~645 KB — see CLAUDE.md's Performance section for the measured
 *  detail/frame-time table this value was picked from. Hardcoded, not overridable by
 *  --detail: that flag is for testing the FULL payload at a different resolution (see
 *  this file's own header comment), and always applies to `full` below. */
const COARSE_DETAIL = 0.006;

const full = buildGeometry(DETAIL);
const coarse = buildGeometry(COARSE_DETAIL);

/* ------------------------------------------------------------------------- flags */

// Committed alongside public/data/, not fetched from svg-country-flags at runtime — the
// app must work offline and no third party should see which flag a browser just
// requested. svg-country-flags (not flag-icons) ships each flag at its own true aspect
// ratio instead of normalising everything to 4:3 — see CLAUDE.md's Quizzes section.
const flagsSrcDir = join(dirname(require.resolve('svg-country-flags/package.json')), 'svg');
const flagsOutDir = join(root, 'public', 'flags');
mkdirSync(flagsOutDir, { recursive: true });

const byIso2 = new Map(countries.map(c => [c.iso2.toLowerCase(), c]));
const wantedFlags = new Set(byIso2.keys());
const missingFlags = [...wantedFlags].filter(iso2 => !existsSync(join(flagsSrcDir, `${iso2}.svg`)));
if (missingFlags.length) {
  throw new Error(`svg-country-flags has no flag for: ${missingFlags.join(', ')}`);
}

/** Every one of these SVGs' root `<svg>` element carries only a `viewBox`, no width/height
 *  attributes (confirmed: 0/197 have one). Throws rather than silently skipping a file,
 *  which is the bug this exists to prevent. */
function viewBoxSize(svg, iso2) {
  const match = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (!match) throw new Error(`flags: ${iso2}.svg has no viewBox to size it from`);
  const parts = match[1].trim().split(/[\s,]+/).map(Number);
  const [, , w, h] = parts;
  if (parts.length !== 4 || !(w > 0) || !(h > 0)) {
    throw new Error(`flags: ${iso2}.svg has an unparseable viewBox "${match[1]}"`);
  }
  return { w, h };
}

/**
 * An <img> with no intrinsic size at all computes to zero height with width/height left
 * auto, no matter what CSS aspect-ratio says — aspect-ratio needs one definite dimension
 * to resolve against, and a bare `viewBox` gives the element neither a natural size nor,
 * in practice, a reliably-honoured natural ratio. Confirmed by looking: every flag
 * rendered invisible until this existed. The fix has to be in the file itself, so every
 * place a flag is used gets a real intrinsic size for free — inject width/height from the
 * viewBox onto the root `<svg>` before writing it to public/flags/, rather than leaving
 * each caller to work around a sizeless image. flagRatio is still emitted on the country
 * record too (Flag.tsx wants a definite number, not a re-parsed viewBox, to size from).
 */
function withIntrinsicSize(svg, w, h, iso2) {
  // The FIRST <svg ...> tag only — some flags (Slovenia's coat of arms) embed a second,
  // nested <svg> deeper in the file that legitimately has its own width/height. Checking
  // (or injecting into) anywhere-in-the-string would false-positive on that nested tag
  // and leave the actual root element still sizeless — confirmed: this is exactly what
  // happened to si.svg before the check was scoped to the root tag specifically.
  const rootTag = svg.match(/<svg\b[^>]*>/);
  if (!rootTag) throw new Error(`flags: ${iso2}.svg has no <svg> root element to size`);
  if (/\bwidth\s*=/.test(rootTag[0]) && /\bheight\s*=/.test(rootTag[0])) return svg;
  const injectedTag = rootTag[0].replace('<svg', `<svg width="${w}" height="${h}"`);
  return svg.slice(0, rootTag.index) + injectedTag + svg.slice(rootTag.index + rootTag[0].length);
}

for (const iso2 of wantedFlags) {
  const svgPath = join(flagsSrcDir, `${iso2}.svg`);
  const svg = readFileSync(svgPath, 'utf8');
  const { w, h } = viewBoxSize(svg, iso2);
  byIso2.get(iso2).flagRatio = w / h;
  writeFileSync(join(flagsOutDir, `${iso2}.svg`), withIntrinsicSize(svg, w, h, iso2), 'utf8');
}

// an orphan here would be a country that shipped once and no longer does — clean it up
// rather than let public/flags/ grow forever
let orphanedFlags = 0;
for (const file of readdirSync(flagsOutDir)) {
  if (!wantedFlags.has(file.replace(/\.svg$/, ''))) {
    unlinkSync(join(flagsOutDir, file));
    orphanedFlags += 1;
  }
}

const flagsBytes = readdirSync(flagsOutDir)
  .reduce((sum, file) => sum + statSync(join(flagsOutDir, file)).size, 0);

/* ------------------------------------------------------------------------- emit */

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
  countries
};
const json = JSON.stringify(payload);
writeFileSync(join(outDir, 'world.json'), json, 'utf8');

/**
 * The reduced-detail counterpart the map loads first (see app/lib/geography/world.ts) —
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
  lakes: coarse.lakes
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

console.log(`countries      ${countries.length}`);
console.log(
  `overrides      ${new Set(overriddenFields.map(f => f.split('.')[0])).size}` +
    (overriddenFields.length ? ` (${overriddenFields.join(', ')})` : '')
);
console.log(
  `disputed       ${new Set(disputedFacets.map(f => f.split('.')[0])).size}` +
    (disputedFacets.length ? ` (${disputedFacets.join(', ')})` : '')
);
console.log(
  `aliases        ${totalAliases}` +
    (droppedAliases ? ` (${droppedAliases} dropped as ambiguous: ${ambiguous.map(([key]) => key).join(', ')})` : '')
);
console.log(`confusable     ${confusablePairCount} pair(s)`);
console.log(
  `absorbed       ${Object.keys(ABSORB).length} ` +
    `(${Object.entries(ABSORB).map(([name, iso3]) => `${name}->${iso3}`).join(', ')})`
);
console.log(`arcs (full)    ${full.arcs.length} (${full.totalPoints.toLocaleString()} points)`);
console.log(`arcs (coarse)  ${coarse.arcs.length} (${coarse.totalPoints.toLocaleString()} points)`);
console.log(`detail (full)  ${DETAIL || '0 — unsimplified; nothing filtered, small islands render'}`);
console.log(`detail (coarse) ${COARSE_DETAIL}`);
console.log(`geometries     ${full.geometries.length}`);
console.log(`lakes          ${full.lakes.length} (${full.lakes.map(l => l.id).join(', ')})`);
console.log(`no polygon     ${noPolygon.length ? noPolygon.join(', ') : 'none'}`);
console.log(`world.json     ${(json.length / 1024).toFixed(0)} KB`);
console.log(`world-coarse   ${(coarseJson.length / 1024).toFixed(0)} KB`);
console.log(`countries.json ${(facts.length / 1024).toFixed(0)} KB`);
console.log(
  `flags          ${wantedFlags.size} (${(flagsBytes / (1024 * 1024)).toFixed(1)} MB)` +
    (orphanedFlags ? `, removed ${orphanedFlags} orphan(s)` : '')
);
