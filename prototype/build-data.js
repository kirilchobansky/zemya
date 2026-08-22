const fs = require('fs');
const path = require('path');
const topo50 = require('world-atlas/countries-50m.json');
const wc = require('world-countries');
const simplify = require('topojson-simplify');
const popData = require('country-json/src/country-by-population.json');
const relData = require('country-json/src/country-by-religion.json');

// ---------- 1. authored content ----------
const authored = {};
for (const f of ['europe', 'asia', 'africa', 'americas', 'oceania']) {
  const txt = fs.readFileSync(path.join(__dirname, 'content', f + '.txt'), 'utf8');
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    const p = line.split('|');
    if (p.length < 5) { console.error('BAD LINE', f, line.slice(0, 40)); continue; }
    authored[p[0].trim()] = { rel: p[1].trim(), flagDesc: p[2].trim(), shape: p[3].trim(), mn: p[4].trim() };
  }
}
console.log('authored:', Object.keys(authored).length);

// ---------- 2. population overrides (2025 estimates, rounded) ----------
const popOverride = {
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
  TWN: 23400220, KOS: 1977093
};

// ---------- 3. build country roster ----------
const extraNonUN = ['VAT', 'PSE', 'TWN'];
const roster = wc.filter(c => c.unMember || extraNonUN.includes(c.cca3));

const popByName = {}; popData.forEach(d => popByName[d.country] = d.population);
const relByName = {}; relData.forEach(d => relByName[d.country] = d.religion);

const langFamily = {
  // rough family grouping for choropleth by language family
  Indo: ['English','Spanish','Portuguese','French','Italian','German','Dutch','Russian','Ukrainian','Belarusian','Polish','Czech','Slovak','Slovene','Croatian','Serbian','Bosnian','Bulgarian','Macedonian','Montenegrin','Romanian','Greek','Albanian','Armenian','Persian','Pashto','Dari','Urdu','Hindi','Bengali','Nepali','Sinhala','Punjabi','Marathi','Kurdish','Tajik','Danish','Swedish','Norwegian','Icelandic','Faroese','Latvian','Lithuanian','Irish','Welsh','Scottish Gaelic','Luxembourgish','Catalan','Romansh','Afrikaans','Dhivehi','Dzongkha','Hindustani','Papiamento','Sranan Tongo','Creole','Haitian Creole','Kriol','Portuguese Creole','Norwegian Nynorsk','Norwegian Bokmål','Serbo-Croatian','Belarusian','Moldovan','Ossetian','Balochi'],
};

const countries = [];
const missingAuthored = [];
for (const c of roster) {
  const a3 = c.cca3;
  const au = authored[a3];
  if (!au) missingAuthored.push(a3 + ' ' + c.name.common);
  const langs = Object.values(c.languages || {});
  const curKey = Object.keys(c.currencies || {})[0];
  const cur = curKey ? c.currencies[curKey] : null;
  countries.push({
    id: String(Number(c.ccn3)),
    a3,
    a2: c.cca2,
    n: c.name.common,
    off: c.name.official,
    fl: c.flag,
    cap: (c.capital && c.capital[0]) || '—',
    curC: curKey || '—',
    curN: cur ? cur.name : '—',
    curS: cur ? (cur.symbol || '') : '',
    pop: popOverride[a3] || popByName[c.name.common] || 0,
    lang: langs[0] || '—',
    langs: langs.slice(0, 4),
    rel: (au && au.rel) || relByName[c.name.common] || 'Various',
    b: c.borders || [],
    ll: c.latlng,
    reg: c.region,
    sub: c.subregion,
    area: c.area,
    ll_: c.landlocked ? 1 : 0,
    mn: au ? au.mn : '',
    fd: au ? au.flagDesc : '',
    sh: au ? au.shape : ''
  });
}
console.log('countries:', countries.length, 'missing authored:', missingAuthored.join(', ') || 'none');

// ---------- 4. geometry ----------
const DROP = new Set(['10']); // Antarctica (ccn3 010)
let topo = JSON.parse(JSON.stringify(topo50));
topo.objects.countries.geometries = topo.objects.countries.geometries
  .filter(g => !DROP.has(String(Number(g.id))));

// simplify
topo = simplify.presimplify(topo);
const THRESH = Number(process.env.THRESH || 0.005);
topo = simplify.simplify(topo, THRESH);
topo = simplify.filter(topo, simplify.filterAttachedWeight(topo, THRESH));

// re-quantize into integer grid
function quantize(t, q) {
  const box = [-180, -85.1, 180, 85.1];
  const kx = (q - 1) / (box[2] - box[0]);
  const ky = (q - 1) / (box[3] - box[1]);
  const arcs = t.arcs.map(arc => {
    // arc currently in absolute coords? topojson-simplify keeps delta+transform. Decode first.
    return arc;
  });
  return t;
}

// decode arcs to absolute, then re-encode with our own transform
const tr = topo.transform;
function absArcs(t) {
  if (!tr) return t.arcs.map(arc => arc.map(p => [p[0], p[1]]));
  return t.arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(p => {
      x += p[0]; y += p[1];
      return [x * tr.scale[0] + tr.translate[0], y * tr.scale[1] + tr.translate[1]];
    });
  });
}
const abs = absArcs(topo);

// our own quantization: 16-bit-ish grid over the world
const Q = 32768;
const X0 = -180, Y0 = -90, XS = 360 / (Q - 1), YS = 180 / (Q - 1);
const outArcs = abs.map(arc => {
  let px = 0, py = 0; const out = [];
  for (const p of arc) {
    const x = Math.round((p[0] - X0) / XS);
    const y = Math.round((p[1] - Y0) / YS);
    const dx = x - px, dy = y - py;
    px = x; py = y;
    if (out.length && dx === 0 && dy === 0) continue;
    out.push([dx, dy]);
  }
  if (out.length < 2) out.push([0, 0]);
  return out;
});

const geoms = topo.objects.countries.geometries.map(g => ({
  i: String(Number(g.id)),
  t: g.type === 'MultiPolygon' ? 2 : 1,
  a: g.arcs,
  n: (g.properties && g.properties.name) || ''
}));

const out = {
  q: Q, x0: X0, y0: Y0, xs: XS, ys: YS,
  arcs: outArcs,
  geoms,
  countries
};

const json = JSON.stringify(out);
fs.writeFileSync(path.join(__dirname, 'world-data.json'), json);
console.log('data bytes:', json.length, ' arcs:', outArcs.length, ' geoms:', geoms.length);
const withPoly = new Set(geoms.map(g => g.i));
console.log('countries without polygon:', countries.filter(c => !withPoly.has(c.id)).map(c => c.a3).join(','));
