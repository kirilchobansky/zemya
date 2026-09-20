/**
 * End-to-end smoke test against the production build.
 *
 * Serves build/client statically the way Cloudflare Pages will, then drives a real
 * browser: the map must paint, hover must hit-test, clicking must navigate *without
 * moving the camera*, the dossier must fill in, overlays must switch, and the
 * size-comparison tool must lift and drop.
 * Any console error or uncaught exception fails the run.
 *
 * The progress step (12) is the one exception: it needs `window.__zemya`, the grading test
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

const searchFlagBox = await page.evaluate(() => {
  const img = document.querySelector('.search__results img.flag');
  if (!(img instanceof HTMLImageElement)) return null;
  return { naturalWidth: img.naturalWidth, clientWidth: img.clientWidth, clientHeight: img.clientHeight };
});
check(
  Boolean(searchFlagBox && searchFlagBox.naturalWidth > 0 && searchFlagBox.clientWidth > 0 && searchFlagBox.clientHeight > 0),
  `the search dropdown's flag image did not render at a real size — ${JSON.stringify(searchFlagBox)}`
);

await page.keyboard.press('Enter');
await page.waitForURL('**/country/bulgaria', { timeout: 5000 });
await page.waitForTimeout(1400);

const dossier = await page.textContent('.panel__body');
for (const probe of ['Sofia', 'Eastern Orthodoxy', 'Euro', 'Romania', 'Cyrillic']) {
  check(dossier.includes(probe), `dossier missing "${probe}"`);
}

/* naturalWidth alone is not enough — it's the decoded image resource's own size, and
   stayed nonzero even in the exact regression this guards against (every flag rendering
   at zero size because width:auto/height:auto has nothing to resolve against when the
   source SVG has no intrinsic dimensions of its own; see Flag.tsx and
   scripts/build-content.mjs). clientWidth/clientHeight is the actual on-screen box, which
   is what was zero — that's the one this check needs to catch. */
const flagBox = await page.evaluate(() => {
  const img = document.querySelector('.dossier__flag img.flag');
  if (!(img instanceof HTMLImageElement)) return null;
  return { complete: img.complete, naturalWidth: img.naturalWidth, clientWidth: img.clientWidth, clientHeight: img.clientHeight };
});
check(
  Boolean(flagBox?.complete && flagBox.naturalWidth > 0 && flagBox.clientWidth > 0 && flagBox.clientHeight > 0),
  `dossier flag <img> did not render at a real size — ${JSON.stringify(flagBox)}`
);

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

/* --- 9. Russia's antimeridian crossing no longer breaks flyTo --------------------- */
await page.goto(`${base}/country/russia`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
const russiaScale = await page.textContent('.scalebar');
check(
  !/10,000 km/.test(russiaScale),
  `camera did not zoom into Russia — scale still reads "${russiaScale.trim()}"`
);

/* --- 10. Malta renders as a real shape at its own zoom, not a permanent dot ------- */
await page.goto(`${base}/country/malta`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400); // longer than the fly animation, so a regression shows up
const [maltaX, maltaY] = await page.evaluate(() => {
  const rect = document.querySelector('canvas').getBoundingClientRect();
  return [rect.left + rect.width / 2, rect.top + rect.height / 2];
});

const BRASS = [232, 163, 61]; // --brass / overlays.ts's SELECTED
const isBrass = (rgb, tolerance = 12) => BRASS.every((c, i) => Math.abs(rgb[i] - c) <= tolerance);

const maltaCentre = await pixelAt(maltaX, maltaY);
check(
  isBrass(maltaCentre),
  `Malta's centre pixel is not the selection colour — got rgb(${maltaCentre.join(',')})`
);

// A 9-pixel pin at the centre would pass the check above too. Also require brass ~40px
// off centre, so what's on screen is a real filled shape with extent, not a dot.
const maltaOffCentre = await pixelAt(maltaX + 40, maltaY);
check(
  isBrass(maltaOffCentre),
  `Malta has no extent beyond its centre pixel — looks like a pin, not a shape ` +
    `(rgb(${maltaOffCentre.join(',')}))`
);

/* --- 11. study mode: answering a question reveals the hook and advances ----------- */
await page.goto(`${base}/study`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.waitForSelector('.quiz__option', { timeout: 5000 }).catch(() => {});
if (await page.isVisible('.quiz__option')) {
  const before = (await page.textContent('.panel__head h2')).trim();
  await page.click('.quiz__option >> nth=0');
  await page.waitForTimeout(300);
  check(
    (await page.textContent('.hook__label').catch(() => '')) === 'Memory hook',
    'answering a study question did not reveal the memory hook'
  );
  await page.click('.action--primary:has-text("Next")');
  await page.waitForTimeout(300);
  const after = (await page.textContent('.panel__head h2')).trim();
  check(after !== before, `answering did not advance to the next question — stayed on "${before}"`);
} else {
  check(false, '/study rendered no question to answer (is a session ever generated?)');
}

/* --- 12. quiz mode hides the search box and the map's own hover tooltip ----------- */
await page.goto(`${base}/quiz/countries/world/20`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
check(!(await page.isVisible('.search')), 'the search box is visible during a quiz run');
await page.mouse.move(700, 430);
await page.waitForTimeout(200);
check(!(await page.isVisible('.tip')), 'the hover tooltip is visible during a quiz run');

/* --- 12b. catalogue scopes: chips re-derive the size ladder; the old URL redirects -- */
await page.goto(`${base}/quiz`, { waitUntil: 'networkidle' });
const ladderOf = async () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.quiz-block')[0].querySelectorAll('.quiz-size-card__n')].map(e => e.textContent)
  );
check((await ladderOf()).join(',') === '20,30,50,90,120,All', `world ladder is ${await ladderOf()}`);
await page.click('.quiz-block >> nth=0 >> .chip:has-text("Oceania")');
check((await ladderOf()).join(',') === 'All', `oceania ladder is ${await ladderOf()}`);
check(
  (await page.getAttribute('.quiz-block >> nth=0 >> .chip:has-text("Oceania")', 'aria-pressed')) === 'true',
  'the Oceania chip does not show as selected'
);
await page.goto(`${base}/quiz/flags/50`, { waitUntil: 'networkidle' });
await page.waitForURL(/\/quiz\/flags\/world\/50$/, { timeout: 5000 }).catch(() => {});
check(/\/quiz\/flags\/world\/50$/.test(page.url()), `the pre-scope URL did not redirect to world — at ${page.url()}`);

/* --- 13. grading a facet updates the rail and repaints the mastery overlay -------- */
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

  /* --- 14. quiz mode: answering advances and never leaks the next country's name --- */
  await page.goto(`${devBase}quiz/countries/world/20`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.click('.quiz-dock__start');
  await page.waitForFunction(() => Boolean(window.__zemyaQuiz && window.__zemyaQuiz.target), { timeout: 5000 });
  await page.waitForTimeout(600);

  const firstQuizState = await page.evaluate(() => window.__zemyaQuiz);
  check(Boolean(firstQuizState?.target), 'quiz exposed no current target after START');

  if (firstQuizState?.target) {
    await page.fill('.quiz-dock__input', firstQuizState.target);
    await page.waitForTimeout(400);

    const afterQuizState = await page.evaluate(() => window.__zemyaQuiz);
    check(
      afterQuizState?.target !== firstQuizState.target,
      'typing the correct name did not advance the quiz'
    );
    check(
      afterQuizState?.answeredCount === firstQuizState.answeredCount + 1,
      `answered count did not increase — ${firstQuizState.answeredCount} -> ${afterQuizState?.answeredCount}`
    );

    // the regression test for the leak: the NEXT target's name must appear nowhere on
    // the page — not as a label, not in a tooltip, not in the panel
    if (afterQuizState?.target) {
      const bodyText = await page.textContent('body');
      check(
        !bodyText.includes(afterQuizState.target),
        `the next target's name ("${afterQuizState.target}") is visible somewhere on the page`
      );
    }
  }

  /* --- 15. pausing freezes the timer; Esc (not just the button) resumes it correctly -- */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const pausedOnce = await page.evaluate(() => window.__zemyaQuiz);
  check(pausedOnce?.phase === 'paused', 'Esc did not pause the run');

  await page.waitForTimeout(500); // while paused — elapsedMs must not move
  const stillPaused = await page.evaluate(() => window.__zemyaQuiz);
  check(
    stillPaused?.elapsedMs === pausedOnce?.elapsedMs,
    `timer kept moving while paused — ${pausedOnce?.elapsedMs} -> ${stillPaused?.elapsedMs}`
  );

  // the actual regression: a SECOND Escape, aimed at what used to be a disabled (and so
  // unfocusable) input, used to do nothing at all
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const resumed = await page.evaluate(() => window.__zemyaQuiz);
  check(resumed?.phase === 'running', 'a second Esc did not resume the run');
  check(
    typeof resumed?.elapsedMs === 'number' && resumed.elapsedMs >= (pausedOnce?.elapsedMs ?? 0),
    `resuming reset the timer instead of continuing it — paused at ${pausedOnce?.elapsedMs}, ` +
      `resumed at ${resumed?.elapsedMs}`
  );

  /* --- 16. finishing a run shows the results screen and records a personal best ----- */
  let guard = 0;
  while (guard++ < 25) {
    const state = await page.evaluate(() => window.__zemyaQuiz);
    if (!state || state.phase === 'done') break;
    if (!state.target) break;
    await page.fill('.quiz-dock__input', state.target);
    await page.waitForTimeout(1500); // outlast the fly-to animation to the next target
  }
  const finishedState = await page.evaluate(() => window.__zemyaQuiz);
  check(finishedState?.phase === 'done', `run did not reach "done" after ${guard} answers`);

  if (finishedState?.phase === 'done') {
    const resultText = await page.textContent('.panel__body');
    check(/personal best/i.test(resultText), 'results screen missing the personal best line');
    check(/first-try/.test(resultText), 'results screen missing the first-try/revealed tally');
    check(!(await page.isVisible('.quiz-dock')), 'the input dock is still visible after finishing');

    await page.click('.action--primary:has-text("Run it again")');
    await page.waitForTimeout(500);
    const restarted = await page.evaluate(() => window.__zemyaQuiz);
    check(restarted?.phase === 'running', '"Run it again" did not start a new run');

    // a second, slower run should report the earlier one as the (unbeaten) personal best
    await page.goto(`${devBase}quiz`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const catalogueText = await page.textContent('.panel__body');
    check(/\d:\d\d\.\d/.test(catalogueText), 'the quiz catalogue shows no personal best time after a finished run');
  }

  /* --- 17. flags quiz: no map, answering advances, and no leaked country name ------ */
  await page.goto(`${devBase}quiz/flags/world/20`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  check(await page.isVisible('.quiz-dock__start'), 'the flags quiz has no START control');
  await page.click('.quiz-dock__start');
  await page.waitForFunction(() => Boolean(window.__zemyaQuiz && window.__zemyaQuiz.target), { timeout: 5000 });
  await page.waitForTimeout(400);

  const firstFlagState = await page.evaluate(() => window.__zemyaQuiz);
  check(Boolean(firstFlagState?.target), 'flags quiz exposed no current target after START');

  // same "actually rendered, not just present" check as the dossier flag above
  const quizFlagBox = await page.evaluate(() => {
    const img = document.querySelector('.quiz-flag-stage__flag img');
    if (!(img instanceof HTMLImageElement)) return null;
    return { naturalWidth: img.naturalWidth, clientWidth: img.clientWidth, clientHeight: img.clientHeight };
  });
  check(
    Boolean(quizFlagBox && quizFlagBox.naturalWidth > 0 && quizFlagBox.clientWidth > 0 && quizFlagBox.clientHeight > 0),
    `the flags quiz's flag image did not render at a real size — ${JSON.stringify(quizFlagBox)}`
  );

  if (firstFlagState?.target) {
    await page.fill('.quiz-dock__input', firstFlagState.target);
    await page.waitForTimeout(400);

    const afterFlagState = await page.evaluate(() => window.__zemyaQuiz);
    check(
      afterFlagState?.target !== firstFlagState.target,
      'typing the correct country name did not advance the flags quiz'
    );
    check(
      afterFlagState?.answeredCount === firstFlagState.answeredCount + 1,
      `flags quiz answered count did not increase — ${firstFlagState.answeredCount} -> ${afterFlagState?.answeredCount}`
    );

    // same leak check as the countries quiz: the NEXT flag's country name must appear
    // nowhere on the page
    if (afterFlagState?.target) {
      const bodyText = await page.textContent('body');
      check(
        !bodyText.includes(afterFlagState.target),
        `the next flag's country name ("${afterFlagState.target}") is visible somewhere on the page`
      );
    }
  }

  /* --- 18. capitals quiz: answering advances, the country name is not an answer, and no
          text anywhere on the page contains a capital's name (the label-leak test) ---- */
  /** Every text node and human-facing attribute value on the page that contains `name` as
   *  a whole word, case-insensitive, diacritic-insensitive. Text nodes only tell half the
   *  story — an aria-label or title would leak just as well — and <script>/<style> are
   *  skipped, since a bundled data blob is not something a player can read. Returns the
   *  offending snippets, so a failure says WHERE the name leaked. */
  const findNameOnPage = (name) =>
    page.evaluate(wanted => {
      const fold = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const escaped = fold(wanted).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
      const hits = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const tag = node.parentElement?.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE') continue;
        if (re.test(fold(node.data))) hits.push(`text: ${node.data.trim().slice(0, 80)}`);
      }
      for (const el of document.body.querySelectorAll('*')) {
        for (const attr of ['aria-label', 'title', 'alt', 'placeholder', 'value']) {
          const v = el.getAttribute(attr);
          if (v && re.test(fold(v))) hits.push(`${el.tagName.toLowerCase()}[${attr}]: ${v.slice(0, 80)}`);
        }
      }
      return hits;
    }, name);

  await page.goto(`${devBase}quiz/capitals/world/20`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  check(await page.isVisible('.quiz-dock__start'), 'the capitals quiz has no START control');
  await page.click('.quiz-dock__start');
  await page.waitForFunction(() => Boolean(window.__zemyaQuiz && window.__zemyaQuiz.target), { timeout: 5000 });
  await page.waitForTimeout(600);

  const firstCapitalState = await page.evaluate(() => window.__zemyaQuiz);
  check(Boolean(firstCapitalState?.targetCapital), 'capitals quiz exposed no current target capital after START');

  if (firstCapitalState?.targetCapital) {
    for (const name of [firstCapitalState.targetCapital, firstCapitalState.target]) {
      const leaks = await findNameOnPage(name);
      check(leaks.length === 0, `"${name}" is visible on the capitals quiz before it was answered — ${leaks.join(' | ')}`);
    }

    // the COUNTRY's name is not the answer — unless the country deliberately shares its
    // name with its capital's accepted names (Mexico, Panama, Luxembourg, ...), in which
    // case it IS one, and the unit tests are what pin that
    const countryNameIsAlsoACapitalName = await page.evaluate(async ({ target, capital }) => {
      const fold = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’‘ʼ`]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const all = await (await fetch('/data/geography/countries.json')).json();
      const country = all.find(c => c.name === target && c.capital === capital);
      return Boolean(country && country.capitalAliases.some(a => fold(a) === fold(target)));
    }, { target: firstCapitalState.target, capital: firstCapitalState.targetCapital });
    if (!countryNameIsAlsoACapitalName) {
      await page.fill('.quiz-dock__input', firstCapitalState.target);
      await page.waitForTimeout(300);
      const afterCountryName = await page.evaluate(() => window.__zemyaQuiz);
      check(
        afterCountryName?.answeredCount === firstCapitalState.answeredCount &&
          afterCountryName?.target === firstCapitalState.target,
        `typing the country's name ("${firstCapitalState.target}") advanced the capitals quiz`
      );
      await page.fill('.quiz-dock__input', '');
    }

    // positive control — the detector above must be able to FAIL. A reveal legitimately
    // shows the answer, so the same scan has to find the capital now; if it doesn't, the
    // "not visible" checks around it prove nothing.
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(300);
    check(
      (await findNameOnPage(firstCapitalState.targetCapital)).length > 0,
      'the leak detector found nothing after a reveal — it cannot be trusted to catch a real leak'
    );

    await page.fill('.quiz-dock__input', firstCapitalState.targetCapital);
    await page.waitForTimeout(400);
    const afterCapitalState = await page.evaluate(() => window.__zemyaQuiz);
    check(
      afterCapitalState?.target !== firstCapitalState.target,
      `typing the capital ("${firstCapitalState.targetCapital}") did not advance the capitals quiz`
    );
    check(
      afterCapitalState?.answeredCount === firstCapitalState.answeredCount + 1,
      `capitals quiz answered count did not increase — ${firstCapitalState.answeredCount} -> ${afterCapitalState?.answeredCount}`
    );

    // and again for what is on screen NOW: the next target's capital, and the one just
    // answered (nothing on the map may keep its name after it is done with)
    if (afterCapitalState?.targetCapital) {
      for (const name of [afterCapitalState.targetCapital, afterCapitalState.target, firstCapitalState.targetCapital]) {
        const leaks = await findNameOnPage(name);
        check(leaks.length === 0, `"${name}" is visible on the capitals quiz after advancing — ${leaks.join(' | ')}`);
      }
    }
  }

  /* --- 19. typing survives touching the canvas: the focus regression test -------------- */
  await page.goto(`${devBase}quiz/countries/world/30`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.click('.quiz-dock__start');
  await page.waitForFunction(() => Boolean(window.__zemyaQuiz && window.__zemyaQuiz.target), { timeout: 5000 });
  await page.waitForTimeout(800);

  const canvasBox = await page.locator('.stage__canvas').boundingBox();
  const activeTag = () => page.evaluate(() => document.activeElement?.tagName ?? 'NONE');
  /** Types `name` from an unfocused state, one key at a time like a person, and reports
   *  whether the run advanced. NO fill(): fill() focuses the element itself, which is
   *  exactly the thing being tested. */
  async function typeFromUnfocused(label) {
    const before = await page.evaluate(() => window.__zemyaQuiz);
    check(await activeTag() !== 'INPUT', `${label}: the input still had focus, so this proves nothing`);
    await page.keyboard.type(before.target, { delay: 25 });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => window.__zemyaQuiz);
    check(
      after.answeredCount === before.answeredCount + 1,
      `${label}: typing "${before.target}" with no focus did not advance the run (first letter dropped?) — answered ${before.answeredCount} -> ${after.answeredCount}`
    );
  }

  // a plain canvas click (pointerdown + pointerup)
  await page.mouse.click(canvasBox.x + 120, canvasBox.y + 200);
  await typeFromUnfocused('after a canvas click');

  // a hard drag, then straight to typing
  await page.mouse.move(canvasBox.x + 300, canvasBox.y + 300);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 520, canvasBox.y + 180, { steps: 12 });
  await page.mouse.up();
  await typeFromUnfocused('after dragging the map');

  // the reset-view button is the manual escape hatch: click it, carry on typing
  await page.click('button[aria-label="Reset view"]');
  await typeFromUnfocused('after clicking the reset-view button');

  // shortcuts must still work with focus on a button, i.e. NOT inside the input
  const beforeTab = await page.evaluate(() => window.__zemyaQuiz);
  await page.click('button[aria-label="Reset view"]');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  const afterTab = await page.evaluate(() => window.__zemyaQuiz);
  check(afterTab.target !== beforeTab.target && afterTab.answeredCount === beforeTab.answeredCount, 'Tab with focus outside the input did not skip');
  await page.click('button[aria-label="Reset view"]');
  check(!(await page.isVisible('.quiz-dock__answer')), 'the answer chip was already showing before Ctrl+Enter');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(300);
  check(await page.isVisible('.quiz-dock__answer'), 'Ctrl+Enter with focus outside the input did not reveal');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check((await page.evaluate(() => window.__zemyaQuiz)).phase === 'paused', 'Esc did not pause');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check((await page.evaluate(() => window.__zemyaQuiz)).phase === 'running', 'Esc did not resume');

  /* --- 20. ONE camera path for every new question: from a zoomed-in view a skip returns to the
          overview exactly as an answer does, and every new target ends up on screen ------- */
  await page.goto(`${devBase}quiz/countries/world/30`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.click('.quiz-dock__start');
  await page.waitForFunction(() => Boolean(window.__zemyaQuiz && window.__zemyaQuiz.target), { timeout: 5000 });
  await page.waitForTimeout(800);
  const cb = await page.locator('.stage__canvas').boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.wheel(0, -Math.log(10) / 0.0016); // ~10x home, wherever the centre is
  await page.waitForTimeout(600);
  const view0 = await page.evaluate(() => window.__zemyaView());
  check(view0.camera.zoom > view0.camera.home * 8, `the test's own zoom-in did not take — zoom ${view0.camera.zoom}`);
  let moved = 0;
  let prev = view0.camera;
  const seen = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500); // the fly-to has settled
    const v = await page.evaluate(() => ({ view: window.__zemyaView(), quiz: window.__zemyaQuiz }));
    const [tx, ty] = v.view.target;
    const c = v.view.canvas;
    const inView = tx >= 0 && tx <= c.right - c.left && ty >= 0 && ty <= v.view.dockTop - c.top;
    check(inView, `after skipping to ${v.quiz.target} its anchor is off screen at (${Math.round(tx)}, ${Math.round(ty)})`);
    // a skip goes through the same code as an answer: back to (near) the overview, not left zoomed in.
    // (world/30 is the 30 most populous countries — none micro — so "near" is well under 3x.)
    check(v.view.camera.zoom < v.view.camera.home * 3, `skipping to ${v.quiz.target} left the camera zoomed in: ${(v.view.camera.zoom / v.view.camera.home).toFixed(2)}x`);
    if (Math.abs(v.view.camera.x - prev.x) > 1e-4 || Math.abs(v.view.camera.y - prev.y) > 1e-4) moved += 1;
    seen.push(v.quiz.target);
    prev = v.view.camera;
  }
  check(moved >= 1, `across ${seen.length} skips at 10x the camera never moved (${seen.join(', ')}) — the first should have returned it to the overview`);
  // zoom back in by hand for the wrong-attempt / pause checks and the guess below
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.wheel(0, -Math.log(10) / 0.0016);
  await page.waitForTimeout(600);
  // "leave it alone" is pinned deterministically (which random targets happen to be in view is
  // luck): a wrong attempt and a pause/resume are not new questions and must not move the camera
  /** Waits until the camera stops moving (two reads 350 ms apart agree) — a fly-to's ease
   *  takes a variable time to fall under its settle threshold, so a fixed sleep is a guess. */
  const settledCamera = async () => {
    let last = (await page.evaluate(() => window.__zemyaView())).camera;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(350);
      const now = (await page.evaluate(() => window.__zemyaView())).camera;
      if (Math.abs(now.x - last.x) < 1e-7 && Math.abs(now.y - last.y) < 1e-7 && now.zoom === last.zoom) return now;
      last = now;
    }
    return last;
  };
  const settled = await settledCamera();
  await page.keyboard.type('zzzz', { delay: 20 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const stillCam = await settledCamera();
  check(
    Math.abs(stillCam.x - settled.x) < 1e-6 && Math.abs(stillCam.y - settled.y) < 1e-6 && stillCam.zoom === settled.zoom,
    'a wrong attempt or a pause/resume moved the camera — only a NEW target may'
  );

  // a GUESS from a zoomed-in view sends the camera back to the world view
  check(stillCam.zoom > stillCam.home * 2, `the test's zoom did not survive to the guess — ${stillCam.zoom / stillCam.home}x`);
  const toGuess = await page.evaluate(() => window.__zemyaQuiz.target);
  await page.fill('.quiz-dock__input', ''); // the wrong attempt above is still in the field
  await page.keyboard.type(toGuess, { delay: 25 });
  await page.waitForTimeout(600);
  const afterGuess = await settledCamera();
  check(
    afterGuess.zoom < afterGuess.home * 3,
    `answering "${toGuess}" while zoomed in left the camera at ${(afterGuess.zoom / afterGuess.home).toFixed(2)}x, not the world view`
  );
  // ...and a SKIP from the same zoomed-in view lands in the same place (one code path)
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.wheel(0, -Math.log(10) / 0.0016);
  await page.waitForTimeout(600);
  const zoomedForSkip = await settledCamera();
  check(zoomedForSkip.zoom > zoomedForSkip.home * 2, `the test's zoom before the skip did not take — ${zoomedForSkip.zoom / zoomedForSkip.home}x`);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(600);
  const afterSkip = await settledCamera();
  check(
    afterSkip.zoom < afterSkip.home * 3,
    `skipping while zoomed in left the camera at ${(afterSkip.zoom / afterSkip.home).toFixed(2)}x — a skip must return the view exactly as an answer does`
  );

  /* --- 21. a continent quiz treats the continent as home: START frames it, and a guess from
          a zoomed-in view returns to it, not to the whole world --------------------- */
  await page.goto(`${devBase}quiz/countries/europe/all`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // before START the camera is already on the continent, behind the start dock
  const europeIdle = (await page.evaluate(() => window.__zemyaView())).camera;
  check(europeIdle.zoom > europeIdle.home * 1.5, `the Europe quiz page left the camera at ${(europeIdle.zoom / europeIdle.home).toFixed(2)}x, not the continent view`);
  await page.click('.quiz-dock__start');
  await page.waitForFunction(() => Boolean(window.__zemyaQuiz && window.__zemyaQuiz.target), { timeout: 5000 });
  await page.waitForTimeout(1500);
  const europeHome = (await page.evaluate(() => window.__zemyaView())).camera;
  check(europeHome.zoom > europeHome.home * 1.2, `Europe quiz START left the camera at ${(europeHome.zoom / europeHome.home).toFixed(2)}x, not the continent view`);
  const eb = await page.locator('.stage__canvas').boundingBox();
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.wheel(0, -Math.log(4) / 0.0016);
  await page.waitForTimeout(800);
  const europeIn = (await page.evaluate(() => window.__zemyaView())).camera;
  check(europeIn.zoom > europeHome.zoom * 2, `the Europe test's own zoom-in did not take — ${europeIn.zoom / europeHome.zoom}x`);
  const europeTarget = await page.evaluate(() => window.__zemyaQuiz.target);
  await page.fill('.quiz-dock__input', '');
  await page.keyboard.type(europeTarget, { delay: 25 });
  await page.waitForTimeout(2500);
  const europeAfter = (await page.evaluate(() => window.__zemyaView())).camera;
  // back to the continent (a target that doesn't fit may zoom out a little further), never
  // left zoomed in and never sent to the whole world
  // a micro-state target legitimately zooms IN past the continent view (its size is guaranteed)
  const microNext = await page.evaluate(() => {
    const t = window.__zemyaQuiz.target;
    return ['Andorra', 'Liechtenstein', 'Monaco', 'Malta', 'San Marino', 'Vatican City', 'Luxembourg'].includes(t);
  });
  check(
    (microNext || europeAfter.zoom < europeIn.zoom * 0.5) && europeAfter.zoom > europeAfter.home * 1.2,
    `answering "${europeTarget}" in a Europe quiz left the camera at ${(europeAfter.zoom / europeAfter.home).toFixed(2)}x home (zoomed-in was ${(europeIn.zoom / europeAfter.home).toFixed(2)}x)`
  );
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
  `PASS — map painted ${colours} colours, dossier, flag image, neighbours, 5 overlays, ` +
    'compare tool, cold prerender, Russia antimeridian, Malta shape, study mode, ' +
    'progress grading, quiz mode (no leak), quiz pause/resume, quiz results and personal best, ' +
    'flags quiz (no leak), capitals quiz (no leak), typing survives canvas/drag/reset, quiz camera follows, continent quiz home'
);
