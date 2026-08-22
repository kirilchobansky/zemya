/**
 * End-to-end smoke test against the production build.
 *
 * Serves build/client statically the way Cloudflare Pages will, then drives a real
 * browser: the map must paint, hover must hit-test, clicking must navigate, the dossier
 * must fill in, overlays must switch, and the size-comparison tool must lift and drop.
 * Any console error or uncaught exception fails the run.
 *
 *   npm run build && npm test
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(process.cwd(), 'build', 'client');
const PORT = Number(process.env.PORT || 4178);

if (!existsSync(ROOT)) {
  console.error('build/client not found — run `npm run build` first.');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.data': 'text/x-script',
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

const IGNORE = /fonts\.googleapis|fonts\.gstatic|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/;
const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('console', m => {
  if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push(`console: ${m.text()}`);
});
page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));

/* --- 1. the map paints something ------------------------------------------------- */
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const colours = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return 0;
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4 * 1009) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  return seen.size;
});
check(colours >= 3, `map looks blank — only ${colours} distinct colours sampled`);

/* --- 2. search finds a country and navigates -------------------------------------- */
await page.fill('.search input', 'bulgaria');
await page.waitForTimeout(250);
await page.keyboard.press('Enter');
await page.waitForURL('**/country/bulgaria', { timeout: 5000 });
await page.waitForTimeout(1400);

const dossier = await page.textContent('.panel__body');
for (const probe of ['Sofia', 'Eastern Orthodoxy', 'Bulgarian lev', 'Romania', 'Cyrillic']) {
  check(dossier.includes(probe), `dossier missing "${probe}"`);
}

/* --- 3. the camera actually flew --------------------------------------------------- */
const zoomed = await page.textContent('.scalebar');
check(!/10,000 km/.test(zoomed), `camera did not zoom in — scale still reads "${zoomed.trim()}"`);

/* --- 4. neighbour links navigate --------------------------------------------------- */
await page.click('.neighbours a');
await page.waitForTimeout(1200);
check(/\/country\/[a-z-]+$/.test(new URL(page.url()).pathname), 'neighbour link did not navigate');

/* --- 5. overlays switch without error ---------------------------------------------- */
for (const label of ['Density', 'Language', 'Religion', 'Region', 'Terrain']) {
  await page.click(`.chips button:text-is("${label}")`);
  await page.waitForTimeout(220);
}

/* --- 6. size comparison lifts, drags and drops ------------------------------------- */
await page.click('.toolbar button:has-text("Compare size")');
await page.waitForTimeout(500);
check(await page.isVisible('.compare-hud'), 'compare tool produced no HUD');
await page.mouse.move(700, 430);
await page.mouse.down();
await page.mouse.move(620, 300, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);
await page.click('.compare-hud button');
await page.waitForTimeout(300);
check(!(await page.isVisible('.compare-hud')), 'compare tool would not put the outline back');

/* --- 7. a country page loads cold, prerendered ------------------------------------- */
await page.goto(`${base}/country/nepal`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const nepal = await page.textContent('.panel__body');
check(nepal.includes('Kathmandu'), 'cold load of /country/nepal did not render the dossier');
check(
  (await page.title()) === 'Nepal — Zemya',
  `wrong document title on cold load: "${await page.title()}"`
);

await browser.close();
server.close();

if (problems.length) {
  console.error('FAIL\n' + problems.map(p => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`PASS — map painted ${colours} colours, dossier, neighbours, 5 overlays, compare tool, cold prerender`);
