/**
 * Frame-time measurement for the map renderer (MapLibre GL over our PMTiles), against the
 * production build.
 *
 * Serves build/client statically (same as test/smoke.mjs), opens a real browser at 1500x900 and
 * waits until the MapLibre instance (window.__zemyaGl, exposed because this script sets
 * __ZEMYA_PROBE__ in an init script — see gl-atlas.ts) reports its style and tiles loaded; that
 * moment is the time-to-rendered-map. Then two phases, each sampled by a requestAnimationFrame
 * recorder running inside the page (frame time = the delta between consecutive callbacks, which
 * is what a player experiences):
 *
 *   pan   a real drag across the map — mouse down, ~90 small pointermove steps, mouse up
 *         (with PERF_DEVICE, a one-finger touch drag over CDP instead)
 *   zoom  wheel steps in then out about the map centre (with PERF_DEVICE, map.easeTo in and
 *         out instead — Playwright has no pinch), until the camera has settled
 *
 * Nothing reads pixels: it is the map's own state and the frame clock.
 *
 *   npm run build && npm run perf
 *   CHROMIUM_PATH=/path/to/chrome npm run perf   (see CLAUDE.md's Known rough edges)
 *
 * Target: 16.7 ms median frame at world zoom (docs/performance.md). The result is printed, not
 * asserted — headless Chromium here renders WebGL in software (the GL renderer line says so), so
 * the number is a regression guard on this machine, not proof about the owner's GPU.
 *
 * Phone mode: PERF_DEVICE names a Playwright device profile ("iPhone 13") — its viewport, DPR
 * and touch. PERF_CPU throttles the CPU (4 = a mid-range phone is roughly 4x slower than a dev
 * machine):
 *   PERF_DEVICE="iPhone 13" PERF_CPU=4 npm run perf
 */
import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(process.cwd(), 'build', 'client');
const PORT = Number(process.env.PORT || 4180);
const PAN_STEPS = 90;
const ZOOM_STEPS = 30;

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
  '.pmtiles': 'application/octet-stream',
  '.pbf': 'application/x-protobuf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
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
      const body = await readFile(candidate);
      const type = MIME[extname(candidate)] || 'application/octet-stream';
      // world.pmtiles is read with HTTP Range requests, as on Vercel
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
        res.writeHead(206, {
          'content-type': type,
          'content-range': `bytes ${start}-${end}/${body.length}`,
          'content-length': end - start + 1,
          'accept-ranges': 'bytes'
        });
        res.end(body.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { 'content-type': type, 'content-length': body.length, 'accept-ranges': 'bytes' });
      res.end(body);
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

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
});
const device = process.env.PERF_DEVICE ? devices[process.env.PERF_DEVICE] : null;
if (process.env.PERF_DEVICE && !device) throw new Error(`unknown PERF_DEVICE "${process.env.PERF_DEVICE}"`);
const cpuRate = Number(process.env.PERF_CPU || 1);
const context = await browser.newContext(device ? { ...device } : { viewport: { width: 1500, height: 900 } });
await context.addInitScript(() => { window.__ZEMYA_PROBE__ = true; });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
if (cpuRate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });

/** Navigates and waits for the map instance to report style + tiles loaded; returns the ms. */
async function timeToRenderedMap() {
  const start = Date.now();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const map = window.__zemyaGl;
    return Boolean(map && map.isStyleLoaded() && map.areTilesLoaded());
  }, null, { timeout: 15000, polling: 20 });
  return Date.now() - start;
}

/** Waits for the camera to stop moving and the tiles to be in. */
const settle = () =>
  page.waitForFunction(() => {
    const map = window.__zemyaGl;
    return !map.isMoving() && map.areTilesLoaded();
  }, null, { timeout: 15000, polling: 50 });

/** Records rAF timestamps while `run` executes plus until the camera settles; returns frame deltas. */
async function sample(run) {
  await page.evaluate(() => {
    window.__perfFrames = [];
    window.__perfRecording = true;
    const tick = t => {
      window.__perfFrames.push(t);
      if (window.__perfRecording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await run();
  await settle();
  const frames = await page.evaluate(() => {
    window.__perfRecording = false;
    return window.__perfFrames;
  });
  const deltas = [];
  for (let i = 1; i < frames.length; i++) deltas.push(frames[i] - frames[i - 1]);
  return deltas.sort((a, b) => a - b);
}

const paintMs = await timeToRenderedMap();
await settle();
await page.waitForTimeout(500); // the initial home animation, if any, is over before we measure

const info = await page.evaluate(() => {
  const map = window.__zemyaGl;
  const canvas = map.getCanvas();
  const rect = canvas.getBoundingClientRect();
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return {
    box: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    canvas: `${canvas.width}x${canvas.height}`,
    dpr: window.devicePixelRatio,
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
    zoom: map.getZoom(),
    renderedCountries: new Set(map.queryRenderedFeatures({ layers: ['countries'] }).map(f => f.id ?? f.properties.iso3)).size
  };
});
if (info.renderedCountries < 40) {
  console.error(`FAIL — only ${info.renderedCountries} countries rendered at the home view; the map is not painting.`);
  process.exit(1);
}

const { box } = info;
const cx = box.left + box.width / 2;
const y = box.top + box.height / 2;

/* ---- pan: a drag across most of the canvas width, at vertical centre ---- */
const xStart = box.left + box.width * 0.15;
const xEnd = box.left + box.width * 0.85;
const panDeltas = await sample(async () => {
  if (device) {
    const touch = (type, x) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', xStart);
    for (let i = 1; i <= PAN_STEPS; i++) await touch('touchMove', xStart + ((xEnd - xStart) * i) / PAN_STEPS);
    await touch('touchEnd', xEnd);
  } else {
    await page.mouse.move(xStart, y);
    await page.mouse.down();
    for (let i = 1; i <= PAN_STEPS; i++) await page.mouse.move(xStart + ((xEnd - xStart) * i) / PAN_STEPS, y);
    await page.mouse.up();
  }
});

/* ---- zoom: in then back out about the centre ---- */
const zoomBefore = await page.evaluate(() => window.__zemyaGl.getZoom());
const zoomDeltas = await sample(async () => {
  if (device) {
    await page.evaluate(() => new Promise(done => {
      const map = window.__zemyaGl;
      const z = map.getZoom();
      map.once('moveend', () => { map.once('moveend', done); map.easeTo({ zoom: z, duration: 1500 }); });
      map.easeTo({ zoom: z + 4, duration: 1500 });
    }));
  } else {
    await page.mouse.move(cx, y);
    for (let i = 0; i < ZOOM_STEPS; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(16); }
    await settle();
    for (let i = 0; i < ZOOM_STEPS; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(16); }
  }
});
const zoomAfter = await page.evaluate(() => window.__zemyaGl.getZoom());

await browser.close();
server.close();

for (const [name, deltas] of [['pan', panDeltas], ['zoom', zoomDeltas]]) {
  if (deltas.length < 20) {
    console.error(`FAIL — only ${deltas.length} frames recorded during the ${name} (the recorder or the map stalled).`);
    process.exit(1);
  }
}

const pct = (deltas, p) => deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * p))];
const fps = ms => (1000 / ms).toFixed(0);
const report = (name, deltas) => {
  const median = pct(deltas, 0.5);
  console.log(
    `${name.padEnd(6)} median ${median.toFixed(1)} ms (${fps(median)} fps)   p95 ${pct(deltas, 0.95).toFixed(1)} ms   ` +
      `worst ${deltas[deltas.length - 1].toFixed(1)} ms   frames ${deltas.length}`
  );
  return median;
};

console.log(`profile   ${device ? process.env.PERF_DEVICE : 'desktop 1500x900'}, CPU ${cpuRate}x, DPR ${info.dpr} (canvas ${info.canvas})`);
console.log(`renderer  ${info.renderer}`);
console.log(`time-to-rendered-map  ${paintMs} ms (${info.renderedCountries} countries at home zoom ${info.zoom.toFixed(2)})`);
const medians = [report('pan', panDeltas), report('zoom', zoomDeltas)];
console.log(`zoom travelled ${zoomBefore.toFixed(2)} -> peak -> ${zoomAfter.toFixed(2)}`);
console.log(
  Math.max(...medians) <= 16.7 * 1.05
    ? 'target 16.7 ms median: met'
    : 'target 16.7 ms median: NOT met here (check the renderer line — software GL is not the owner\'s GPU)'
);
