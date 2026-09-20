/**
 * Flag audit: cross-checks every country's authored `flag` description against its shipped
 * SVG, rasterised in Chromium. Prints a report and changes nothing; a human decides every case.
 *
 *   node scripts/audit-flags.mjs        (needs Chromium — see docs/decisions.md if it won't launch)
 *
 * Three checks: (1) a described colour that is absent from the picture, (2) band order and
 * direction, but ONLY for descriptions that are a plain colour list followed by "bands", and
 * (3) the count of stars up to nine. It was written after svg-country-flags shipped Syria's
 * pre-2024 flag; run against that old file it flags both the band order and the star count.
 *
 * KNOWN LIMITATION — do not "fix" New Zealand. Its description ("four red stars of the
 * Southern Cross") is right; the star counter reports 8 because the Union Jack in the canton is
 * also red and its fragments are star-sized blobs. The same goes for flags where the
 * description is deliberately a summary of unequal or thin bands: the check samples at equal
 * fractions, so it is a prompt to look, not a verdict. Set AUDIT_SVG_<ISO2>=path to test the
 * audit against a different file (e.g. AUDIT_SVG_SY=old-sy.svg).
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const countries = JSON.parse(readFileSync(root + 'public/data/geography/countries.json', 'utf8'));

// ---- colour vocabulary
const WORD = {
  red: 'red', crimson: 'red', carmine: 'red', maroon: 'red', orange: 'orange', saffron: 'orange', copper: 'orange',
  yellow: 'yellow', gold: 'yellow', golden: 'yellow', green: 'green', olive: 'green', blue: 'blue', navy: 'blue',
  sky: 'blue', aquamarine: 'blue', white: 'white', black: 'black', grey: 'grey',
};
const ACCEPT = { // described family -> pixel families that satisfy it
  red: ['red', 'orange'], orange: ['orange', 'red', 'yellow'], yellow: ['yellow', 'orange'],
  green: ['green', 'cyan'], blue: ['blue', 'cyan'], white: ['white', 'grey'], black: ['black'], grey: ['grey', 'white', 'black'],
};
function family(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
  if (l < 0.09 || (l < 0.2 && s < 0.25)) return 'black';
  if (l > 0.88) return 'white';
  if (s < 0.18) return 'grey';
  if (h < 15 || h >= 340) return 'red';
  if (h < 40) return l < 0.32 ? 'red' : 'orange';
  if (h < 70) return 'yellow';
  if (h < 170) return 'green';
  if (h < 195) return 'cyan';
  if (h < 262) return 'blue';
  return 'purple';
}
const W = 240;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');
async function raster(iso2) {
  const svg = readFileSync(process.env['AUDIT_SVG_' + iso2.toUpperCase()] || `${root}public/flags/${iso2}.svg`, 'utf8');
  return page.evaluate(async ({ svg, W }) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    await img.decode();
    const H = Math.round(W * img.naturalHeight / img.naturalWidth);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, W, H);
    return { H, data: Array.from(x.getImageData(0, 0, W, H).data) };
  }, { svg, W });
}

const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const findings = [];
for (const c of countries) {
  const desc = c.flagDescription, low = desc.toLowerCase(), iso = c.iso2.toLowerCase();
  const { H, data } = await raster(iso);
  const fam = new Array(W * H);
  const cover = {};
  for (let i = 0; i < W * H; i++) {
    const a = data[i * 4 + 3];
    const f = a < 128 ? 'clear' : family(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    fam[i] = f; cover[f] = (cover[f] || 0) + 1 / (W * H);
  }
  const at = (x, y) => fam[Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))];
  const issues = [];

  // 1. described colours absent from the rendered flag (<0.5% of pixels)
  const described = [...new Set((low.match(/[a-z]+/g) || []).filter(w => WORD[w]).map(w => WORD[w]))];
  for (const d of described) {
    const got = ACCEPT[d].reduce((s, f) => s + (cover[f] || 0), 0);
    if (got < 0.005) issues.push(`colour: describes ${d}, flag has ${(got * 100).toFixed(2)}% of it`);
  }

  // 2. band order. Only when the description opens with a colour list ending in bands/stripes,
  //    or "<n> horizontal|vertical bands: a, b, c".
  let seq = null, dirWord = null;
  const m1 = desc.match(/^([A-Za-z\-, ]+?)\s+(?:(horizontal|vertical)\s+)?bands\b/i);
  const m2 = desc.match(/(horizontal|vertical)\s+(?:bands|stripes)\s*:\s*([^.;]+)/i);
  const listText = m2 ? m2[2] : m1 ? m1[1] : null;
  if (listText) {
    const toks = listText.toLowerCase().match(/[a-z]+/g);
    const pure = toks.every(w => WORD[w] || w === 'and'); // no "with", number words, "hoist", ...
    const ws = toks.filter(w => WORD[w]).map(w => WORD[w]);
    const dedup = ws.filter((w, i) => w !== ws[i - 1]);
    // five bands that the description itself calls unequal (Suriname, Eswatini) can't be
    // checked by sampling at equal fractions; three-band 1:2:1 flags can, and it caught Cambodia
    const unequal = dedup.length >= 5 && /\b(wide|wider|widest|thin)\b/i.test(desc);
    if (pure && !unequal && dedup.length >= 2 && dedup.length <= 5) seq = dedup;
    dirWord = (m2 ? m2[1] : m1 && m1[2] ? m1[2] : '').toLowerCase() || null;
  }
  if (seq) {
    const n = seq.length;
    // fly-side / bottom-edge samples, away from hoist triangles and central emblems; two
    // positions per axis, either may satisfy (a canton or emblem can spoil one)
    const reads = (dir, k) => seq.map((_, i) => dir === 'horizontal'
      ? at(W * (k ? 0.5 : 0.94), H * (i + 0.5) / n) : at(W * (i + 0.5) / n, H * (k ? 0.94 : 0.06)));
    const ok = s => s.every((f, i) => ACCEPT[seq[i]].includes(f));
    const okDir = d => ok(reads(d, 0)) || ok(reads(d, 1));
    const revDir = d => [0, 1].some(k => reads(d, k).slice().reverse().every((f, i) => ACCEPT[seq[i]].includes(f)));
    const dirs = dirWord ? [dirWord] : ['horizontal', 'vertical'];
    if (!dirs.some(okDir)) {
      const other = dirWord === 'vertical' ? 'horizontal' : 'vertical';
      const why = dirs.some(revDir) ? ' (REVERSED order)' : dirWord && okDir(other) ? ' (WRONG DIRECTION)' : '';
      issues.push(`bands: described ${seq.join('/')} ${dirWord ?? 'either direction'}${why}; sampled H=${reads('horizontal', 0).join('/')} V=${reads('vertical', 0).join('/')}`);
    }
  }

  // 3. star count: "<number> [colour] stars" — count connected blobs of that colour, size-filtered.
  const ms = low.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:[a-z]+\s+)?stars?\b/);
  if (ms && !/pointed|-pointed/.test(ms[0])) {
    const n = NUM[ms[1]];
    const colourWord = (ms[0].match(/[a-z]+/g) || []).map(w => WORD[w]).find(Boolean);
    if (colourWord && n <= 9) {
      const want = ACCEPT[colourWord];
      const seen = new Uint8Array(W * H); let blobs = 0;
      for (let s = 0; s < W * H; s++) {
        if (seen[s] || !want.includes(fam[s])) continue;
        let stack = [s], area = 0; seen[s] = 1;
        while (stack.length) { const p = stack.pop(); area++; const x = p % W, y = (p - x) / W;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const q = ny * W + nx;
            if (!seen[q] && want.includes(fam[q])) { seen[q] = 1; stack.push(q); } } }
        const frac = area / (W * H);
        if (frac > 0.0008 && frac < 0.06) blobs++;
      }
      if (blobs !== n) issues.push(`stars: describes ${n} ${colourWord} star(s), found ${blobs} ${colourWord} blob(s) of star size (heuristic; check by eye)`);
    }
  }
  if (issues.length) findings.push({ iso: c.iso2, name: c.name, desc, issues });
}
await browser.close();
for (const f of findings) console.log(`${f.iso} ${f.name}: "${f.desc}"\n   - ${f.issues.join('\n   - ')}`);
console.log(`\n${findings.length} of ${countries.length} flagged`);
