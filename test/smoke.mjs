/**
 * End-to-end smoke test against the production build.
 *
 * Serves build/client statically the way Cloudflare Pages will, then drives a real
 * browser: the map must paint, hover must hit-test, clicking must navigate *without
 * moving the camera*, the dossier must fill in, overlays must switch, and the
 * size-comparison tool must lift and drop.
 * Any console error or uncaught exception fails the run.
 *
 * The progress step (9) is the one exception: it needs `window.__zemya`, the grading test
 * seam, which is stripped from the production bundle by `import.meta.env.DEV` — by design,
 * see app/lib/core/ProgressProvider.tsx. So it spawns its own `react-router dev` server
 * rather than using `base`, and tears that server down in a `finally` so a failed
 * assertion inside it can never leave `npm test` hanging on an orphaned process.
 *
 *   npm run build && npm test
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
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

/* --- 2. a map click selects but leaves the camera alone --------------------------- */
const restingScale = (await page.textContent('.scalebar')).trim();

/* probe for a point that is actually over land — the tooltip only renders on a hit */
let landPoint = null;
for (const point of [[430, 330], [980, 330], [760, 250], [1150, 430], [520, 560], [880, 620]]) {
  await page.mouse.move(point[0], point[1]);
  await page.waitForTimeout(180);
  if (await page.isVisible('.tip')) { landPoint = point; break; }
}
check(Boolean(landPoint), 'no land found under any probe point — map click untested');

if (landPoint) {
  await page.mouse.click(landPoint[0], landPoint[1]);
  await page.waitForURL('**/country/**', { timeout: 5000 });
  await page.waitForTimeout(1400); // longer than any fly animation, so a regression shows up
  const afterClick = (await page.textContent('.scalebar')).trim();
  check(
    afterClick === restingScale,
    `map click moved the camera — scale bar went "${restingScale}" -> "${afterClick}"`
  );
  check(
    (await page.textContent('.panel__body')).includes('Memory hook'),
    'map click did not open a dossier'
  );
}

/* --- 3. search finds a country and navigates -------------------------------------- */
await page.fill('.search input', 'bulgaria');
await page.waitForTimeout(250);
await page.keyboard.press('Enter');
await page.waitForURL('**/country/bulgaria', { timeout: 5000 });
await page.waitForTimeout(1400);

const dossier = await page.textContent('.panel__body');
for (const probe of ['Sofia', 'Eastern Orthodoxy', 'Bulgarian lev', 'Romania', 'Cyrillic']) {
  check(dossier.includes(probe), `dossier missing "${probe}"`);
}

/* --- 4. the camera actually flew --------------------------------------------------- */
const zoomed = await page.textContent('.scalebar');
check(!/10,000 km/.test(zoomed), `camera did not zoom in — scale still reads "${zoomed.trim()}"`);

/* --- 5. neighbour links navigate --------------------------------------------------- */
await page.click('.neighbours a');
await page.waitForTimeout(1200);
check(/\/country\/[a-z-]+$/.test(new URL(page.url()).pathname), 'neighbour link did not navigate');

/* --- 6. overlays switch without error ---------------------------------------------- */
for (const label of ['Density', 'Language', 'Religion', 'Region', 'Terrain']) {
  await page.click(`.chips button:text-is("${label}")`);
  await page.waitForTimeout(220);
}

/* --- 7. size comparison lifts, drags and drops ------------------------------------- */
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

/* --- 8. a country page loads cold, prerendered ------------------------------------- */
await page.goto(`${base}/country/nepal`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const nepal = await page.textContent('.panel__body');
check(nepal.includes('Kathmandu'), 'cold load of /country/nepal did not render the dossier');
check(
  (await page.title()) === 'Nepal — Zemya',
  `wrong document title on cold load: "${await page.title()}"`
);

/* --- 9. grading a facet updates the rail and repaints the mastery overlay --------- */
const DEV_STARTUP_TIMEOUT_MS = Number(process.env.DEV_STARTUP_TIMEOUT_MS || 60_000);
let devServer = null;
let devOutput = '';

/** Strip ANSI escapes (colour, bold, …) so a captured-output error message is readable —
 *  and so nothing downstream ever needs to pattern-match coloured bytes. On GitHub
 *  Actions, Vite/React Router emit colour (e.g. "\x1b[1mLocal\x1b[22m:") even though the
 *  same command run locally through a pipe does not, because CI allocates a TTY-like
 *  stream. A regex looking for the literal text "Local:" silently fails there — the origin
 *  of this whole readiness rewrite. Parsing stdout for anything, coloured or not, is no
 *  longer on the critical path; this is kept only for readable error output. */
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Ask the OS for a free port up front, rather than guessing one and hoping nothing else
 *  on the runner has it. */
async function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Poll the dev server's own URL with a real HTTP request until it answers, with a hard
 *  ceiling. Readiness is only ever "a request to this exact address succeeded" — never
 *  something inferred from captured stdout/stderr. */
async function waitForDevServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not accepting connections yet */
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(
    `dev server did not come up within ${timeoutMs}ms polling ${url}\n${stripAnsi(devOutput)}`
  );
}

/** Reads one canvas pixel at a page (CSS) coordinate, accounting for the canvas's own
 *  internal resolution (set from devicePixelRatio in Atlas#resize) — see atlas.ts. */
async function pixelAt(x, y) {
  return page.evaluate(([px, py]) => {
    const canvas = document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    const cx = Math.round(((px - rect.left) / rect.width) * canvas.width);
    const cy = Math.round(((py - rect.top) / rect.height) * canvas.height);
    const [r, g, b] = canvas.getContext('2d').getImageData(cx, cy, 1, 1).data;
    return [r, g, b];
  }, [x, y]);
}

try {
  const devPort = await getFreePort();
  const devHost = '127.0.0.1';
  const devBase = `http://${devHost}:${devPort}/`;

  devServer = spawn(
    'npx',
    ['react-router', 'dev', '--host', devHost, '--port', String(devPort), '--strictPort'],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      // Belt and braces: force colour off however picocolors decides to detect it, so
      // captured output is never coloured regardless of the parent's own TTY/env state
      // (the React Router CLI's own --no-color flag is documentation-only in this
      // version — it is not a recognised parseArgs option and errors out if passed).
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
    }
  );
  devServer.stdout.on('data', d => { devOutput += d; });
  devServer.stderr.on('data', d => { devOutput += d; });

  await waitForDevServer(devBase, DEV_STARTUP_TIMEOUT_MS);

  await page.goto(devBase, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => Boolean(window.__zemya), { timeout: 5000 });

  await page.fill('.search input', 'bulgaria');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForURL('**/country/bulgaria', { timeout: 5000 });
  await page.waitForTimeout(1400);

  /* find a point over Bulgaria (the flown-to, selected country) via the hover tooltip */
  let bulgariaPoint = null;
  for (const point of [[700, 430], [750, 400], [650, 460], [800, 380], [720, 480]]) {
    await page.mouse.move(point[0], point[1]);
    await page.waitForTimeout(150);
    const tip = await page.textContent('.tip').catch(() => '');
    if (tip.includes('Bulgaria')) { bulgariaPoint = point; break; }
  }
  check(Boolean(bulgariaPoint), 'could not find Bulgaria under any probe point on the dev server');

  if (bulgariaPoint) {
    /* deselect on open ocean so the SELECTED colour stops masking the overlay, but the
       camera — and so bulgariaPoint — stays exactly where it is (see fix/camera-only-on-intent).
       Candidates must land on the canvas itself (roughly x < 1120) — the panel to its right
       also fails the "no tooltip" test but is not the map, and a click there does not deselect. */
    let oceanPoint = null;
    for (const point of [[1080, 150], [600, 780], [1050, 200], [650, 800]]) {
      await page.mouse.move(point[0], point[1]);
      await page.waitForTimeout(120);
      if (!(await page.isVisible('.tip'))) { oceanPoint = point; break; }
    }
    check(Boolean(oceanPoint), 'could not find open ocean to deselect on the dev server');
    if (oceanPoint) await page.mouse.click(oceanPoint[0], oceanPoint[1]);
    await page.waitForTimeout(400);

    await page.click('.chips button:text-is("Mastery")');
    await page.waitForTimeout(300);
    await page.mouse.move(30, 30); // off-canvas, so nothing is left hovered while sampling

    const before1 = await pixelAt(bulgariaPoint[0], bulgariaPoint[1]);
    const before2 = await pixelAt(bulgariaPoint[0], bulgariaPoint[1]);
    check(
      before1.join() === before2.join(),
      `pixel sampling is unstable even with nothing changing — ${before1} vs ${before2}`
    );

    const tallyBefore = await page.$$eval('.tally__n', els => els.map(e => e.textContent.trim()));

    /* grade a few facets of Bulgaria twice each — two `good` grades is enough for a fresh
       FSRS card to pass its learning steps and graduate to Review (verified separately) */
    await page.evaluate(ids => {
      for (const id of ids) {
        window.__zemya.review(id, 'good');
        window.__zemya.review(id, 'good');
      }
    }, ['geo:BGR:capital', 'geo:BGR:flag', 'geo:BGR:currency']);
    await page.waitForTimeout(300);

    const tallyAfter = await page.$$eval('.tally__n', els => els.map(e => e.textContent.trim()));
    check(
      Number(tallyAfter[1]) === Number(tallyBefore[1]) + 1 &&
        Number(tallyAfter[2]) === Number(tallyBefore[2]) - 1,
      `rail counts did not move as expected: ${tallyBefore} -> ${tallyAfter}`
    );

    const after = await pixelAt(bulgariaPoint[0], bulgariaPoint[1]);
    check(
      after.join() !== before1.join(),
      `mastery overlay pixel under Bulgaria did not change after grading — stayed ${after}`
    );
  }
} finally {
  if (devServer) {
    try {
      process.kill(-devServer.pid, 'SIGTERM');
    } catch {
      /* already dead, or the platform doesn't support process groups */
    }
    devServer.kill('SIGKILL');
  }
}

await browser.close();
server.close();

if (problems.length) {
  console.error('FAIL\n' + problems.map(p => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(
  `PASS — map painted ${colours} colours, dossier, neighbours, 5 overlays, compare tool, ` +
    'cold prerender, progress grading'
);
