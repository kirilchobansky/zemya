/**
 * Content pipeline: content/geography/**  ->  public/data/geography/world.json
 *
 * Joins hand-authored YAML against two upstream datasets and emits one payload the app
 * fetches at runtime. The output is committed so a deploy can never break because an
 * upstream package published a new version.
 *
 *   node scripts/build-content.mjs [--detail=0.02]
 *
 * Default detail is 0 — full 1:10m resolution, unsimplified (measured: 3.37 MB raw / 687 KB
 * gzipped, paints in ~585 ms, pans at a solid 60 fps). Pass --detail=N to simplify back down;
 * dial it up if the unsimplified payload ever stops being affordable.
 */
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, unlinkSync,
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
    outlineDescription: a.outline
  };
  countries.push(applyOverride(record, a, `content/geography/countries/${a.slug}.yaml`));
}

const missing = Object.keys(authored).filter(iso3 => !countries.some(c => c.iso3 === iso3));
if (missing.length) throw new Error(`authored countries with no ISO record: ${missing.join(', ')}`);

/* ---------------------------------------------------------------------- geometry */

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
if (DETAIL > 0) {
  topo = simplify.presimplify(topo);
  topo = simplify.simplify(topo, DETAIL);
  topo = simplify.filter(topo, simplify.filterAttachedWeight(topo, DETAIL));
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

const X0 = -180, Y0 = -90, XS = 360 / (QUANT - 1), YS = 180 / (QUANT - 1);
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

// the cost of a detail change, made visible: the points actually shipped, after
// requantisation drops repeated vertices. At DETAIL=0 (the default) nothing upstream of
// that dedup is filtered — every point in the source 1:10m file survives.
const totalPoints = arcs.reduce((sum, arc) => sum + arc.length, 0);

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
  const merged = [...entry.polygons, ...extra];
  entry.polygons = merged;
  entry.multi = merged.length > 1;
  entry.arcs = merged.length > 1 ? merged : merged[0];
}

const geometries = built.map(({ id, multi, arcs }) => ({ id, multi, arcs }));

/* ------------------------------------------------------------------------- emit */

const withGeometry = new Set(geometries.map(g => g.id));
const noPolygon = countries.filter(c => !withGeometry.has(c.id)).map(c => c.iso3);

const payload = {
  version: 1,
  generated: { detail: DETAIL, quantisation: QUANT },
  grid: { x0: X0, y0: Y0, xs: XS, ys: YS },
  arcs,
  geometries,
  countries
};

const outDir = join(root, 'public', 'data', 'geography');
mkdirSync(outDir, { recursive: true });
const json = JSON.stringify(payload);
writeFileSync(join(outDir, 'world.json'), json, 'utf8');

// facts without geometry: what route loaders read at build time, so a country page's
// HTML is complete before the 480 KB map payload has even started downloading
const facts = JSON.stringify(countries);
writeFileSync(join(outDir, 'countries.json'), facts, 'utf8');

// the slug list the router prerenders from
writeFileSync(
  join(outDir, 'slugs.json'),
  JSON.stringify(countries.map(c => c.slug).sort()),
  'utf8'
);

/* ------------------------------------------------------------------------- flags */

// Committed alongside public/data/, not fetched from flag-icons at runtime — the app
// must work offline and no third party should see which flag a browser just requested.
const flagsSrcDir = join(dirname(require.resolve('flag-icons/package.json')), 'flags', '4x3');
const flagsOutDir = join(root, 'public', 'flags');
mkdirSync(flagsOutDir, { recursive: true });

const wantedFlags = new Set(countries.map(c => c.iso2.toLowerCase()));
const missingFlags = [...wantedFlags].filter(iso2 => !existsSync(join(flagsSrcDir, `${iso2}.svg`)));
if (missingFlags.length) {
  throw new Error(`flag-icons has no flag for: ${missingFlags.join(', ')}`);
}
for (const iso2 of wantedFlags) {
  copyFileSync(join(flagsSrcDir, `${iso2}.svg`), join(flagsOutDir, `${iso2}.svg`));
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

console.log(`countries      ${countries.length}`);
console.log(
  `overrides      ${new Set(overriddenFields.map(f => f.split('.')[0])).size}` +
    (overriddenFields.length ? ` (${overriddenFields.join(', ')})` : '')
);
console.log(
  `absorbed       ${Object.keys(ABSORB).length} ` +
    `(${Object.entries(ABSORB).map(([name, iso3]) => `${name}->${iso3}`).join(', ')})`
);
console.log(`arcs           ${arcs.length} (${totalPoints.toLocaleString()} points)`);
console.log(`detail         ${DETAIL || '0 — unsimplified; nothing filtered, small islands render'}`);
console.log(`geometries     ${geometries.length}`);
console.log(`no polygon     ${noPolygon.length ? noPolygon.join(', ') : 'none'}`);
console.log(`world.json     ${(json.length / 1024).toFixed(0)} KB`);
console.log(`countries.json ${(facts.length / 1024).toFixed(0)} KB`);
console.log(
  `flags          ${wantedFlags.size} (${(flagsBytes / (1024 * 1024)).toFixed(1)} MB)` +
    (orphanedFlags ? `, removed ${orphanedFlags} orphan(s)` : '')
);
