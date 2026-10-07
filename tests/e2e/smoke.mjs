/**
 * End-to-end smoke test: `npm run build && npm test` (or `node tests/e2e/smoke.mjs [--only=map,phone]`).
 *
 * Serves build/client statically, then drives a real browser through one module per area
 * (tests/e2e/areas/). The map is WebGL: nothing here reads pixels. It asks the MapLibre instance
 * (window.__zemyaGl, exposed to a page that sets __ZEMYA_PROBE__ in an init script — see
 * gl-setup.ts) what it has rendered and which feature state each country carries. Any console
 * error or uncaught exception fails the run, and so does a crash inside an area: it is recorded
 * and the next area still runs, so one run reports everything that is broken.
 *
 * Areas marked `dev` need the DEV-only test seams (window.__zemya, __zemyaQuiz, __zemyaView),
 * which are stripped from the production bundle on purpose — they run against a `react-router dev`
 * server this runner spawns on first use and always stops in a `finally`.
 *
 * Waiting is by condition, never by sleeping (lib/waits.mjs), so a run on the same code gives the
 * same result.
 */
import { chromium, devices } from 'playwright';
import { requireBuild, startStaticServer } from './lib/static-server.mjs';
import { startDevServer } from './lib/dev-server.mjs';
import * as map from './areas/map.mjs';
import * as questions from './areas/questions.mjs';
import * as quizList from './areas/quiz-list.mjs';
import * as progress from './areas/progress.mjs';
import * as quizRun from './areas/quiz-run.mjs';
import * as quizKinds from './areas/quiz-kinds.mjs';
import * as quizInput from './areas/quiz-input.mjs';
import * as quizCamera from './areas/quiz-camera.mjs';
import * as history from './areas/history.mjs';
import * as phone from './areas/phone.mjs';
import * as historyStack from './areas/history-stack.mjs';
import * as loadFailures from './areas/load-failures.mjs';

const AREAS = [
  { name: 'map', run: map.run },
  { name: 'load-failures', run: loadFailures.run },
  { name: 'history-stack', run: historyStack.run },
  { name: 'questions', run: questions.run },
  { name: 'quiz-list', run: quizList.run },
  { name: 'history', run: history.run },
  { name: 'progress', run: progress.run, dev: true },
  { name: 'quiz-run', run: quizRun.run, dev: true },
  { name: 'quiz-kinds', run: quizKinds.run, dev: true },
  { name: 'quiz-input', run: quizInput.run, dev: true },
  { name: 'quiz-camera', run: quizCamera.run, dev: true },
  { name: 'phone', run: phone.run, dev: true }
];

const only = (process.argv.find(a => a.startsWith('--only=')) || process.env.ONLY || '').replace('--only=', '').split(',').filter(Boolean);
const selected = AREAS.filter(a => !only.length || only.includes(a.name));
if (only.length && selected.length !== only.length) {
  console.error(`unknown area in --only (known: ${AREAS.map(a => a.name).join(', ')})`);
  process.exit(2);
}

requireBuild();
const { server, base } = await startStaticServer(Number(process.env.PORT || 4178));

const IGNORE = /fonts\.googleapis|fonts\.gstatic|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|favicon/;
const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };

/** Reports console errors and uncaught exceptions of `target` as problems (with the failing URL
 *  for a "Failed to load resource", whose text alone does not say which one). */
function watch(target, label) {
  target.on('console', m => {
    if (m.type() !== 'error' || IGNORE.test(m.text())) return;
    const url = /Failed to load resource/.test(m.text()) ? ` (${m.location().url})` : '';
    problems.push(`${label}console: ${m.text()}${url}`);
  });
  target.on('pageerror', e => problems.push(`${label}pageerror: ${e.message}`));
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.addInitScript(() => { window.__ZEMYA_PROBE__ = true; });
const geometryRequests = [];
page.on('request', r => { if (/\/data\/geography\/world\.json/.test(r.url())) geometryRequests.push(r.url()); });
watch(page, '');

const ctx = { browser, page, base, devBase: null, check, problems, devices, watch };
const ran = [];
let dev = null;
try {
  for (const area of selected) {
    if (area.dev && !dev) {
      dev = await startDevServer();
      ctx.devBase = dev.base;
    }
    const started = Date.now();
    const before = problems.length;
    try {
      await area.run(ctx);
    } catch (error) {
      const at = String(error.stack).split('\n').find(line => /tests\/e2e\/areas/.test(line))?.trim().replace(/^at /, '');
      problems.push(`${area.name}: the area crashed — ${String(error.message).split('\n')[0]}${at ? ` [${at}]` : ''}`);
    }
    ran.push(`${area.name} ${((Date.now() - started) / 1000).toFixed(0)}s${problems.length > before ? ' FAILED' : ''}`);
  }
} finally {
  dev?.stop();
  await browser.close();
  server.close();
}

if (!only.length) {
  check(
    geometryRequests.length === 0,
    `the 3.4 MB world.json was fetched (${geometryRequests[0]}) — the app must only use world-coarse.json and the PMTiles`
  );
}
console.log(`areas: ${ran.join(', ')}`);
if (problems.length) {
  console.error('FAIL\n' + problems.map(p => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`PASS — ${selected.map(a => a.name).join(', ')}`);
