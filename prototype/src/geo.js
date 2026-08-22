/* ============================================================
   GEO — topology decoding, Mercator projection, geometry
   ============================================================ */
const D = WORLD;                       // injected dataset
const RAD = Math.PI / 180;
const MAXLAT = 85.05112878;

/* ---- decode delta-encoded, quantized arcs into lon/lat ---- */
const ARCS = D.arcs.map(a => {
  let x = 0, y = 0;
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    x += a[i][0]; y += a[i][1];
    out[i] = [x * D.xs + D.x0, y * D.ys + D.y0];
  }
  return out;
});

function ringOf(idxs) {
  let pts = [];
  for (const i of idxs) {
    const rev = i < 0;
    const arc = ARCS[rev ? ~i : i];
    if (!arc) continue;
    const seg = rev ? arc.slice().reverse() : arc;
    if (pts.length) pts = pts.concat(seg.slice(1));
    else pts = seg.slice();
  }
  return pts;
}

/* ---- Mercator: lon/lat -> world unit square [0,1] ---- */
function mx(lon) { return (lon + 180) / 360; }
function my(lat) {
  const l = Math.max(-MAXLAT, Math.min(MAXLAT, lat));
  const s = Math.sin(l * RAD);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
function unMy(y) {
  const n = Math.PI * (1 - 2 * y);
  return Math.atan(Math.sinh(n)) / RAD;
}
function unMx(x) { return x * 360 - 180; }

/* ---- build per-country geometry ---- */
const BYID = {}, BY3 = {}, LIST = [];
D.countries.forEach(c => {
  c.polys = [];        // array of arrays of rings, each ring = [[lon,lat],…]
  c.bbox = null;
  c.micro = false;
  BYID[c.id] = c; BY3[c.a3] = c; LIST.push(c);
});

D.geoms.forEach(g => {
  const c = BYID[g.i];
  if (!c) return;
  const polys = g.t === 2 ? g.a : [g.a];
  for (const poly of polys) {
    const rings = poly.map(ringOf).filter(r => r.length > 2);
    if (rings.length) c.polys.push(rings);
  }
});

function ringArea(r) {                 // signed area in deg² (for picking a label point)
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    a += (r[j][0] * r[i][1] - r[i][0] * r[j][1]);
  return a / 2;
}

LIST.forEach(c => {
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, best = null, bestA = -1;
  for (const poly of c.polys) {
    const r = poly[0];
    const a = Math.abs(ringArea(r));
    if (a > bestA) { bestA = a; best = r; }
    for (const p of r) {
      if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
      if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
    }
  }
  if (best) {
    c.bbox = [minx, miny, maxx, maxy];
    let sx = 0, sy = 0;
    for (const p of best) { sx += p[0]; sy += p[1]; }
    c.lab = [sx / best.length, sy / best.length];
    c.mainRing = best;
    const dx = (maxx - minx) * Math.cos(((miny + maxy) / 2) * RAD), dy = maxy - miny;
    c.micro = Math.max(dx, dy) < 0.55;      // too small to ever render as a shape
  } else {
    c.bbox = null; c.micro = true;
    c.lab = [c.ll[1], c.ll[0]];
  }
  if (!c.lab || !isFinite(c.lab[0])) c.lab = [c.ll[1], c.ll[0]];
  c.cx = mx(c.lab[0]); c.cy = my(c.lab[1]);
});

/* ---- Path2D in world-unit space, cached ---- */
LIST.forEach(c => {
  if (!c.polys.length) { c.path = null; return; }
  const p = new Path2D();
  for (const poly of c.polys) {
    for (const ring of poly) {
      // split rings that jump the antimeridian so they don't smear across the map
      let started = false, prev = null;
      for (const pt of ring) {
        if (prev && Math.abs(pt[0] - prev[0]) > 180) { started = false; }
        const X = mx(pt[0]), Y = my(pt[1]);
        if (!started) { p.moveTo(X, Y); started = true; } else p.lineTo(X, Y);
        prev = pt;
      }
      p.closePath();
    }
  }
  c.path = p;
});

/* ---- context landmasses (Greenland, Western Sahara, dependencies…) ---- */
const CONTEXT = [];
D.geoms.forEach(g => {
  if (BYID[g.i]) return;
  const polys = g.t === 2 ? g.a : [g.a];
  const p = new Path2D();
  let any = false;
  for (const poly of polys) {
    for (const idxs of poly) {
      const ring = ringOf(idxs);
      if (ring.length < 3) continue;
      let started = false, prev = null;
      for (const pt of ring) {
        if (prev && Math.abs(pt[0] - prev[0]) > 180) started = false;
        const X = mx(pt[0]), Y = my(pt[1]);
        if (!started) { p.moveTo(X, Y); started = true; } else p.lineTo(X, Y);
        prev = pt;
      }
      p.closePath(); any = true;
    }
  }
  if (any) CONTEXT.push({ path: p, n: g.n });
});

/* ---- neighbours: resolve ISO3 codes to country objects present in the set ---- */
LIST.forEach(c => { c.nb = (c.b || []).filter(x => BY3[x]); });

/* ---- derived study metadata ---- */
const LANG_FAMILY = (() => {
  const F = {
    'Indo-European': ['English','Spanish','Portuguese','French','Italian','German','Dutch','Russian','Ukrainian','Belarusian','Polish','Czech','Slovak','Slovene','Croatian','Serbian','Bosnian','Bulgarian','Macedonian','Montenegrin','Romanian','Moldovan','Greek','Albanian','Armenian','Persian','Pashto','Dari','Urdu','Hindi','Bengali','Nepali','Sinhala','Punjabi','Marathi','Kurdish','Tajik','Danish','Swedish','Norwegian','Norwegian Bokmål','Norwegian Nynorsk','Icelandic','Faroese','Latvian','Lithuanian','Irish','Welsh','Scottish Gaelic','Luxembourgish','Catalan','Romansh','Afrikaans','Dhivehi','Hindustani','Papiamento','Sranan Tongo','Haitian Creole','Balochi','Ossetian','Serbo-Croatian','Portuguese Creole'],
    'Afro-Asiatic': ['Arabic','Hebrew','Amharic','Tigrinya','Somali','Berber','Maltese','Hausa','Oromo'],
    'Sino-Tibetan': ['Chinese','Mandarin','Burmese','Dzongkha','Tibetan'],
    'Niger-Congo': ['Swahili','Zulu','Xhosa','Shona','Kinyarwanda','Kirundi','Lingala','Kikongo','Tswana','Sotho','Southern Sotho','Northern Sotho','Chewa','Chichewa','Bislama','Sango','Kikuyu','Wolof','Fula','Yoruba','Igbo','Comorian','Swati','Ndebele','Tsonga','Venda','Malagasy','Tumbuka','Umbundu','Kongo','Luba-Katanga'],
    'Austronesian': ['Indonesian','Malay','Filipino','Tagalog','Javanese','Fijian','Samoan','Tongan','Māori','Malagasy','Marshallese','Nauru','Palauan','Chamorro','Tetum','Hiri Motu','Gilbertese','Tok Pisin','Bislama'],
    'Turkic': ['Turkish','Azerbaijani','Kazakh','Uzbek','Kyrgyz','Turkmen','Tatar'],
    'Austroasiatic': ['Vietnamese','Khmer'],
    'Tai-Kadai': ['Thai','Lao'],
    'Japonic / Koreanic': ['Japanese','Korean'],
    'Uralic': ['Finnish','Estonian','Hungarian'],
    'Other families': ['Georgian','Basque','Quechua','Aymara','Guaraní','Greenlandic','Mongolian','Nauruan','Papuan','Creole','Haitian Creole','Seychellois Creole','Mauritian Creole','French Creole']
  };
  const m = {};
  for (const fam in F) for (const l of F[fam]) if (!(l in m)) m[l] = fam;
  return m;
})();

LIST.forEach(c => {
  c.fam = LANG_FAMILY[c.lang] || 'Other families';
  c.dens = c.area ? c.pop / c.area : 0;
  c.relGroup = (r => {
    if (/Islam/i.test(r)) return 'Islam';
    if (/Judaism/i.test(r)) return 'Judaism';
    if (/Hindu/i.test(r)) return 'Hinduism';
    if (/Buddh/i.test(r)) return 'Buddhism';
    if (/Shinto|folk|Vodun|ancestor/i.test(r) && !/Christian|Catholic|Protest|Orthodox/i.test(r)) return 'Folk / traditional';
    if (/Atheism|no religion|Juche/i.test(r) && !/Christian/i.test(r)) return 'Secular / none';
    if (/Catholic|Protest|Orthodox|Christian|Anglican/i.test(r)) return 'Christianity';
    return 'Other';
  })(c.rel);
});

const STUDY = LIST.slice().sort((a, b) => b.pop - a.pop);
const REGIONS = [...new Set(LIST.map(c => c.reg))].sort();

/* ---- true-size re-projection: move a shape and keep its ground area ---- */
function trueSizeRings(c, targetLon, targetLat) {
  const [lon0, lat0] = c.lab;
  const out = [];
  for (const poly of c.polys) {
    for (const ring of poly) {
      const nr = [];
      for (const [lon, lat] of ring) {
        const dyKm = (lat - lat0) * 110.574;
        const dxKm = (lon - lon0) * 111.320 * Math.cos(lat * RAD);
        const nlat = targetLat + dyKm / 110.574;
        const cosn = Math.cos(nlat * RAD);
        const nlon = targetLon + dxKm / (111.320 * (Math.abs(cosn) < 1e-4 ? 1e-4 : cosn));
        nr.push([nlon, nlat]);
      }
      out.push(nr);
    }
  }
  return out;
}
