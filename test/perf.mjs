/**
 * Frame-time measurement for the map renderer, against the production build.
 *
 * Serves build/client statically (same as test/smoke.mjs), opens a real browser at
 * 1500x900, measures time-to-painted-map, then simulates a pan gesture — mouse down,
 * ~90 small pointermove steps across the canvas, mouse up — while a requestAnimationFrame
 * sampler running inside the page records every frame's timestamp. Frame time is the
 * delta between consecutive rAF callbacks, which is what a player actually experiences
 * regardless of whether the work happened synchronously inside a pointermove handler (as
 * it does here — the drag path in atlas.ts calls draw() directly, not through rAF) or an
 * animation loop.
 *
 * "It feels smoother" is not evidence. This number is.
 *
 *   npm run build && npm run perf
 *   CHROMIUM_PATH=/path/to/chrome npm run perf   (see CLAUDE.md's Known rough edges)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(process.cwd(), 'build', 'client');
const PORT = Number(process.env.PORT || 4180);
const PAN_STEPS = 90;

if (!existsSync(ROOT)) {
  console.error('build/client not found — run `npx react-router build` first (NOT `npm run build`');
  console.error('if you are measuring a hand-built payload — see CLAUDE.md\'s Performance section).');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const candidates = [join(ROOT, url), join(ROOT, url, 'index.html')];
  for (const candidate of candidates) {
    if (!candidate.startsWith(ROOT)) break;
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      res.writeHead(200, { 'content-type': MIME[extname(candidate)] || 'application/octet-stream' });
      res.end(await readFile(candidate));
      return;
    } catch {
      /* try the next candidate */
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

await new Promise(done => server.listen(PORT, done));
const base = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

/** Polls the canvas for real content (>= 3 distinct sampled colours — same threshold
 *  test/smoke.mjs uses), timing from just before navigation to the first passing poll. */
async function timeToPaintedMap() {
  const start = Date.now();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const deadline = start + 15000;
  while (Date.now() < deadline) {
    const colours = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas || !canvas.width) return 0;
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4 * 1009) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return seen.size;
    });
    if (colours >= 3) return Date.now() - start;
    await page.waitForTimeout(20);
  }
  throw new Error('map never painted within 15s');
}

const paintMs = await timeToPaintedMap();
await page.waitForTimeout(500); // let the initial fly/settle animation finish before measuring pan

const canvasBox = await page.evaluate(() => {
  const rect = document.querySelector('canvas').getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
});

await page.evaluate(() => {
  window.__perfFrames = [];
  window.__perfRecording = true;
  function tick(t) {
    window.__perfFrames.push(t);
    if (window.__perfRecording) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
});

// A pan across most of the canvas width, at a fixed height near vertical centre —
// exercises the same "camera moving at world zoom" path the profile flagged.
const y = canvasBox.top + canvasBox.height / 2;
const xStart = canvasBox.left + canvasBox.width * 0.15;
const xEnd = canvasBox.left + canvasBox.width * 0.85;

await page.mouse.move(xStart, y);
await page.mouse.down();
for (let i = 1; i <= PAN_STEPS; i++) {
  const x = xStart + ((xEnd - xStart) * i) / PAN_STEPS;
  await page.mouse.move(x, y);
}
await page.mouse.up();

await page.waitForTimeout(50); // let the last frame or two land
const frames = await page.evaluate(() => {
  window.__perfRecording = false;
  return window.__perfFrames;
});

await browser.close();
server.close();

const deltas = [];
for (let i = 1; i < frames.length; i++) deltas.push(frames[i] - frames[i - 1]);
deltas.sort((a, b) => a - b);

if (deltas.length < PAN_STEPS / 2) {
  console.error(`FAIL — only ${deltas.length} frames recorded during the pan (expected close to ${PAN_STEPS}).`);
  process.exit(1);
}

const median = deltas[Math.floor(deltas.length / 2)];
const p95 = deltas[Math.floor(deltas.length * 0.95)];
const worst = deltas[deltas.length - 1];
const fps = (ms) => (1000 / ms).toFixed(0);

console.log(`time-to-painted-map   ${paintMs} ms`);
console.log(`frame time (median)   ${median.toFixed(1)} ms  (${fps(median)} fps)`);
console.log(`frame time (p95)      ${p95.toFixed(1)} ms  (${fps(p95)} fps)`);
console.log(`frame time (worst)    ${worst.toFixed(1)} ms  (${fps(worst)} fps)`);
console.log(`frames sampled        ${deltas.length}`);
