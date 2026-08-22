/**
 * One-off migration: prototype/content/*.txt  ->  content/geography/countries/<slug>.yaml
 *
 * Kept in the repo for provenance. It reads the frozen prototype, so re-running it after
 * hand-edits to the YAML would overwrite them — it refuses unless --force is passed.
 *
 *   node scripts/migrate-content.mjs [--force]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { stringify } from 'yaml';
import { slugFor } from './lib/slug.mjs';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'content', 'geography', 'countries');
const force = process.argv.includes('--force');

if (existsSync(OUT) && readdirSync(OUT).length && !force) {
  console.error(`${OUT} already has files. This would overwrite hand-edits. Pass --force if you mean it.`);
  process.exit(1);
}

/* population overrides carried over from the prototype's build script — 2025 estimates
   for the larger states, where the World Bank 2018 baseline is meaningfully stale */
const POP = {
  IND: 1450935791, CHN: 1416096094, USA: 341814420, IDN: 283487931, PAK: 251269164,
  NGA: 232679478, BRA: 211998573, BGD: 173562364, RUS: 144820423, ETH: 132059767,
  MEX: 130861007, JPN: 123753041, EGY: 116538258, PHL: 115843670, COD: 109276265,
  VNM: 100987686, IRN: 91567738, TUR: 87473805, DEU: 84552242, THA: 71668011,
  TZA: 68560157, GBR: 69138192, FRA: 66548530, ZAF: 64007187, ITA: 59342867,
  KEN: 56432944, MMR: 54500091, COL: 52886363, KOR: 51717590, SDN: 50448963,
  UGA: 50015092, ESP: 47910526, DZA: 46814308, IRQ: 46042015, ARG: 45696159,
  AFG: 42647492, YEM: 40583164, CAN: 39742430, POL: 38539201, MAR: 37840044,
  AGO: 37885849, UKR: 37860221, UZB: 36361859, MYS: 35557673, MOZ: 34631766,
  GHA: 34427414, PER: 34217848, SAU: 33962757, MDG: 31964956, CIV: 31934230,
  NPL: 29651054, CMR: 29123744, VEN: 28405543, NER: 27032412, AUS: 26713205,
  MLI: 24478595, BFA: 23548781, SYR: 23865423, LKA: 23103565, MWI: 21655286,
  KAZ: 20592571, CHL: 19764771, ZMB: 21314956, ROU: 19015088, SOM: 19009151,
  TCD: 20299123, SEN: 18501984, GTM: 18406359, NLD: 18228742, ZWE: 16634373,
  KHM: 17638801, SSD: 11943408, RWA: 14256567, GIN: 14754785, BEN: 14462724,
  BDI: 14395011, TUN: 12277109, BOL: 12413315, BEL: 11753499, HTI: 11772557,
  CUB: 10979783, JOR: 11552876, DOM: 11427557, CZE: 10706242, SWE: 10606999,
  PRT: 10425292, GRC: 10047817, AZE: 10336577, HUN: 9855745, ARE: 11027129,
  TJK: 10590927, ISR: 9387021, AUT: 9120813, CHE: 8921981, PNG: 10576502,
  HND: 10825703, SRB: 6736216, BGR: 6714560, DNK: 5977412, FIN: 5617310,
  NOR: 5576660, IRL: 5308039, NZL: 5251899, SGP: 6036860, PRY: 6929153,
  SLV: 6338193, LBY: 7361263, NIC: 6916140, KGZ: 7186009, TKM: 7494498,
  LAO: 7769819, LBN: 5805962, PSE: 5495443, CRI: 5129910, OMN: 5281538,
  KWT: 4934507, PAN: 4515577, MRT: 5169395, MNG: 3475540, JAM: 2839175,
  ALB: 2791765, LTU: 2859110, SVN: 2118697, LVA: 1871882, EST: 1360546,
  HRV: 3875325, BIH: 3164253, MKD: 2085679, MDA: 3435931, GEO: 3807670,
  ARM: 2973840, BLR: 9056696, SVK: 5460193, QAT: 3048423, BHR: 1607049,
  CYP: 1358282, LUX: 673036, MLT: 539607, ISL: 393600, MNE: 638479,
  URY: 3386588, BWA: 2521139, NAM: 3030131, GAB: 2538952, LSO: 2337594,
  GMB: 2759988, GNB: 2201352, GNQ: 1892516, SWZ: 1242822, DJI: 1168722,
  FJI: 928784, TLS: 1400638, MDV: 527799, BRN: 462721, BLZ: 417072,
  CPV: 524877, SUR: 634431, BTN: 792680, COM: 866628, SLB: 819198,
  VUT: 327777, WSM: 218764, STP: 235536, LCA: 179744, KIR: 134518,
  GRD: 117207, VCT: 100616, TON: 104175, SYC: 130418, ATG: 93772,
  AND: 81938, DMA: 66205, MHL: 37548, KNA: 46843, LIE: 39584,
  MCO: 38631, SMR: 33642, PLW: 17727, TUV: 9646, NRU: 11947,
  VAT: 764, BHS: 401283, BRB: 282467, TTO: 1408966, GUY: 831087,
  ECU: 18135478, MUS: 1271169, FSM: 526849, ERI: 3535603, TGO: 9515236,
  SLE: 8642022, LBR: 5612817, COG: 6332961, CAF: 5330690, PRK: 26498823,
  TWN: 23400220
};

const wc = require('world-countries');
const byIso3 = Object.fromEntries(wc.map(c => [c.cca3, c]));

const authored = {};
for (const region of ['europe', 'asia', 'africa', 'americas', 'oceania']) {
  const txt = readFileSync(join(root, 'prototype', 'content', `${region}.txt`), 'utf8');
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    const [iso3, religion, flag, outline, hook] = line.split('|').map(s => s.trim());
    if (!hook) { console.error('malformed line in ' + region + ': ' + line.slice(0, 40)); continue; }
    authored[iso3] = { religion, flag, outline, hook };
  }
}

mkdirSync(OUT, { recursive: true });
const index = [];
let written = 0;

for (const [iso3, a] of Object.entries(authored)) {
  const c = byIso3[iso3];
  if (!c) { console.error(`no ISO record for ${iso3}`); continue; }
  const slug = slugFor(c);
  const doc = {
    iso3,
    slug,
    name: c.name.common,
    religion: a.religion,
    flag: a.flag,
    outline: a.outline,
    hook: a.hook
  };
  if (POP[iso3]) doc.population = POP[iso3];

  const header =
    `# ${c.name.common} (${iso3})\n` +
    `#\n` +
    `# Authored content only. Capital, currency, languages, borders, area and the flag\n` +
    `# emoji all come from the ISO dataset at build time — do not duplicate them here.\n` +
    `#\n` +
    `#   religion  specific, not a coarse bucket (Eastern Orthodoxy, not Christianity)\n` +
    `#   flag      geometry and colour, readable aloud without seeing the flag\n` +
    `#   outline   the silhouette as a thing you would recognise\n` +
    `#   hook      one concrete, surprising sentence. never an encyclopaedia summary\n` +
    `#   population  optional override; omit to use the dataset value\n\n`;

  writeFileSync(join(OUT, `${slug}.yaml`), header + stringify(doc, { lineWidth: 0 }), 'utf8');
  index.push({ iso3, slug, name: c.name.common });
  written++;
}

index.sort((a, b) => a.slug.localeCompare(b.slug));
const dupes = index.filter((x, i) => i && x.slug === index[i - 1].slug);
if (dupes.length) {
  console.error('DUPLICATE SLUGS: ' + dupes.map(d => d.slug).join(', '));
  process.exit(1);
}

console.log(`wrote ${written} country files to content/geography/countries/`);
console.log(`slugs: ${index.slice(0, 3).map(i => i.slug).join(', ')} … ${index.slice(-2).map(i => i.slug).join(', ')}`);
