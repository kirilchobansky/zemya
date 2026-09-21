/**
 * Renders public/og-image.png — the one 1200x630 social card every page shares — from the
 * coarse world geometry in public/data/geography, in the app's own palette. Not part of
 * `npm run build` (the PNG is committed, like the flags); rerun it if the identity changes:
 *
 *   node scripts/build-og-image.mjs        (CHROMIUM_PATH=... where Playwright's own is missing)
 *
 * Per-country cards are a later idea (docs/decisions.md), not built.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const world = JSON.parse(readFileSync('public/data/geography/world-coarse.json', 'utf8'));
const ROUND = 2;

/** Delta-decoded quantised arcs -> [lon, lat] rings. */
const { x0, y0, xs, ys } = world.grid;
const arcs = world.arcs.map(arc => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => [x0 + (x += dx) * xs, y0 + (y += dy) * ys]);
});
const ring = idxs => idxs.flatMap(i => (i < 0 ? [...arcs[~i]].reverse() : arcs[i]));
const polygons = world.geometries.flatMap(g => (g.multi ? g.arcs : [g.arcs]));
const rings = polygons.flatMap(p => p.map(ring));

const html = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;background:#080D13}
  canvas{display:block}
</style><canvas id="c" width="1200" height="630"></canvas>
<script>
const rings = ${JSON.stringify(rings.map(r => r.map(([a, b]) => [+a.toFixed(ROUND), +b.toFixed(ROUND)])))};
const c = document.getElementById('c'), g = c.getContext('2d');
g.fillStyle = '#080D13'; g.fillRect(0, 0, 1200, 630);
// Web Mercator, the app's projection, centred on the Atlantic side of the world.
const W = 1500, cx = 600 + 90, cy = 300;
const X = lon => cx + (lon - 10) / 360 * W;
const Y = lat => { const s = Math.sin(Math.max(-80, Math.min(80, lat)) * Math.PI / 180);
  return cy - Math.log((1 + s) / (1 - s)) / 2 * (W / (2 * Math.PI)); };
g.strokeStyle = 'rgba(36,53,67,0.9)'; g.lineWidth = 1;
for (let lon = -180; lon <= 180; lon += 30) { g.beginPath(); g.moveTo(X(lon), 0); g.lineTo(X(lon), 630); g.stroke(); }
for (let lat = -60; lat <= 80; lat += 20) { g.beginPath(); g.moveTo(0, Y(lat)); g.lineTo(1200, Y(lat)); g.stroke(); }
g.fillStyle = '#31485A'; g.strokeStyle = '#4b6b82'; g.lineWidth = 0.8;
for (const r of rings) {
  g.beginPath();
  // a segment that jumps across the antimeridian is a wrap, not a line: break the path
  r.forEach(([lon, lat], i) => (i && Math.abs(lon - r[i - 1][0]) < 180 ? g.lineTo(X(lon), Y(lat)) : g.moveTo(X(lon), Y(lat))));
  g.fill(); g.stroke();
}
// scrim so the wordmark reads over the land
const grad = g.createLinearGradient(0, 0, 780, 0);
grad.addColorStop(0, 'rgba(8,13,19,0.96)'); grad.addColorStop(0.55, 'rgba(8,13,19,0.82)'); grad.addColorStop(1, 'rgba(8,13,19,0)');
g.fillStyle = grad; g.fillRect(0, 0, 1200, 630);
// instrument mark
g.strokeStyle = '#E8A33D'; g.lineWidth = 3;
g.beginPath(); g.arc(120, 190, 44, 0, Math.PI * 2); g.stroke();
g.lineWidth = 2; g.beginPath(); g.moveTo(120, 150); g.lineTo(120, 230); g.moveTo(80, 190); g.lineTo(160, 190); g.stroke();
g.fillStyle = '#E6EEF3'; g.font = '600 150px Fraunces, Georgia, "Times New Roman", serif';
g.fillText('Zemya', 96, 400);
g.fillStyle = '#E8A33D'; g.font = '500 30px "IBM Plex Mono", "DejaVu Sans Mono", monospace';
g.fillText('COGNITIVE GEOGRAPHY', 100, 462);
g.fillStyle = '#9FB3C0'; g.font = '400 34px Archivo, "Helvetica Neue", Arial, sans-serif';
g.fillText('An atlas you can learn from.', 100, 528);
</script>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'public/og-image.png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log('wrote public/og-image.png');
