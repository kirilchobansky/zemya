/**
 * Freshness audit: flags shipped fields that are likely to have gone stale upstream. It prints a
 * report and changes NOTHING — a human decides every case (fix with an `override:` block in the
 * country's YAML, with a note, per CLAUDE.md's Content conventions).
 *
 *   npm run audit        run before any release
 *
 * Two signals, because each catches what the other misses:
 *
 *  1. DISAGREEMENT between two independent datasets. Shipped records come from world-countries;
 *     countries-list is a separate package with its own maintainer, so where they disagree one of
 *     them is out of date. Compared: currency, capital, name. A disagreement says "look here", not
 *     "the second source is right" — countries-list is wrong about plenty (see the notes it prints).
 *  2. A WATCHLIST of things that changed recently or are easy to get wrong, each with the value we
 *     expect to ship, why, and when it was last reviewed. A mismatch here is a
 *     confirmed problem; extend the list when the world changes something.
 *
 * Population is deliberately excluded: it is approximate by nature and would drown the signal.
 * Country borders, languages and religion aren't covered — no second source that isn't derived
 * from the first.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { countries: second } = require('countries-list');
const root = fileURLToPath(new URL('../', import.meta.url));
const shipped = JSON.parse(readFileSync(root + 'public/data/geography/countries.json', 'utf8'));

const norm = s =>
  String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’‘ʼ`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/* ------------------------------------------------------------ 1. two-source disagreement */

const rows = [];
for (const c of shipped) {
  const other = second[c.iso2];
  if (!other) { rows.push([c.iso2, c.name, 'presence', 'in shipped set', 'absent from countries-list']); continue; }

  // currency: the FIRST listed is the primary; a code that is merely somewhere in the list
  // (Zimbabwe lists BWP among nine) is reported separately, as the weaker signal it is
  const [primary] = other.currency;
  if (c.currencyCode !== primary) {
    const weak = other.currency.includes(c.currencyCode);
    rows.push([c.iso2, c.name, 'currency', `${c.currencyCode} (${c.currencyName})`,
      `${other.currency.join(', ')}${weak ? '  [ours is listed, but not first]' : ''}`]);
  }

  // capital: theirs may hold several ("Pretoria, Bloemfontein, Cape Town"); ours counts as
  // agreeing if it, or any name we accept for it, matches one of them
  const theirCaps = String(other.capital).split(/[,;/]/).map(norm).filter(Boolean);
  const ourCaps = c.capitalAliases.map(norm);
  if (!theirCaps.some(t => ourCaps.includes(t)) && !ourCaps.some(o => theirCaps.includes(o))) {
    rows.push([c.iso2, c.name, 'capital', c.capital, other.capital]);
  }

  // name: agreeing if theirs is our name or anything we accept for it
  const accepted = new Set([c.name, c.officialName, ...c.aliases].map(norm));
  if (!accepted.has(norm(other.name))) rows.push([c.iso2, c.name, 'name', c.name, other.name]);
}

/* -------------------------------------------------------------------- 2. the watchlist */

// [iso2, field, expected, why, last reviewed]
const WATCH = [
  ['BG', 'currencyCode', 'EUR', 'Bulgaria adopted the euro on 1 January 2026', '2026-09'],
  ['HR', 'currencyCode', 'EUR', 'Croatia adopted the euro on 1 January 2023', '2026-09'],
  ['SL', 'currencyCode', 'SLE', 'Sierra Leone redenominated the leone (SLL -> SLE) in 2022', '2026-09'],
  ['ZW', 'currencyCode', 'ZWG', 'Zimbabwe Gold replaced the Zimbabwe dollar in 2024', '2026-09'],
  ['VE', 'currencyCode', 'VES', 'Venezuela: bolivar soberano (VES) since 2021', '2026-09'],
  ['MR', 'currencyCode', 'MRU', 'Mauritania: new ouguiya (MRU) since 2018', '2026-09'],
  ['ST', 'currencyCode', 'STN', 'Sao Tome: new dobra (STN) since 2018', '2026-09'],
  ['BI', 'capital', 'Gitega', 'Burundi moved its political capital from Bujumbura in 2019', '2026-09'],
  ['KZ', 'capital', 'Astana', 'Nur-Sultan was renamed back to Astana in 2022', '2026-09'],
  ['TZ', 'capital', 'Dodoma', 'Tanzania: Dodoma is the capital, Dar es Salaam the commercial city', '2026-09'],
  ['ID', 'capital', 'Jakarta', 'Nusantara is designated but Jakarta stays capital until a presidential decree — ' +
    'Constitutional Court confirmed May 2026; target for a political capital is 2028. Re-check.', '2026-09'],
  ['TR', 'name', 'Türkiye', 'Renamed Türkiye at the UN in 2022', '2026-09'],
  ['SZ', 'name', 'Eswatini', 'Swaziland renamed Eswatini in 2018', '2026-09'],
  ['MK', 'name', 'North Macedonia', 'Renamed in 2019', '2026-09'],
  ['CZ', 'name', 'Czechia', 'Official short form since 2016', '2026-09'],
  ['CV', 'name', 'Cabo Verde', 'Government-requested official short name since 2013 (UN uses it)', '2026-09'],
  ['MM', 'name', 'Myanmar', 'Name in current use', '2026-09']
];
const watchRows = WATCH.map(([iso2, field, expected, why, checked]) => {
  const c = shipped.find(x => x.iso2 === iso2);
  const actual = c?.[field];
  return { iso2, field, expected, actual, why, checked, ok: norm(actual ?? '') === norm(expected) };
});

/* ------------------------------------------------------------------------ the report */

const line = '─'.repeat(78);
console.log(`${line}\nFRESHNESS AUDIT — ${shipped.length} shipped countries vs countries-list\n${line}`);
console.log(`\n1. Disagreements between the two datasets: ${rows.length}`);
for (const r of rows) console.log(`   ${r[0]}  ${r[1].padEnd(24)} ${r[2].padEnd(9)} ships: ${r[3]}  |  other: ${r[4]}`);

const bad = watchRows.filter(w => !w.ok);
console.log(`\n2. Watchlist: ${watchRows.length} entries, ${bad.length} not matching`);
for (const w of watchRows) {
  console.log(`   ${w.ok ? 'ok      ' : 'MISMATCH'} ${w.iso2} ${w.field.padEnd(12)} ${w.ok ? w.actual : `ships "${w.actual}", expected "${w.expected}"`}  — ${w.why} (reviewed ${w.checked})`);
}
console.log(`\n${line}\nnothing was changed. Fix a real one with an override block + note in content/geography/countries/<slug>.yaml\n${line}`);
