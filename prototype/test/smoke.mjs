/**
 * Headless smoke test for the prototype build.
 * Loads dist/zemya-prototype.html, cycles every mode, answers a few questions,
 * and fails on any console error or uncaught exception.
 *
 *   npm run build && npm test
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const page_url = 'file://' + resolve(here, '..', 'dist', 'zemya-prototype.html');
const MODES = ['study', 'review', 'time', 'elim', 'route', 'match', 'shape', 'trophy', 'explore'];

if (!existsSync(resolve(here, '..', 'dist', 'zemya-prototype.html'))) {
  console.error('dist/zemya-prototype.html not found — run `npm run build` first.');
  process.exit(1);
}

const IGNORE = /ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|fonts\.googleapis|fonts\.gstatic/;
const problems = [];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push('console: ' + m.text()); });
page.on('pageerror', e => problems.push('pageerror: ' + e.message));

await page.goto(page_url);
await page.waitForTimeout(1200);

// 1. the map actually painted something other than ocean
const painted = await page.evaluate(() => {
  const cv = document.querySelector('canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 1009) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
  return seen.size;
});
if (painted < 3) problems.push(`map looks blank — only ${painted} distinct colours sampled`);

// 2. search finds a country and flies to it
await page.fill('#search', 'bulgaria');
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
const dossier = await page.textContent('#panel-body');
if (!/Sofia/.test(dossier)) problems.push('dossier did not open for Bulgaria');

// 3. every mode renders a panel
for (const m of MODES) {
  await page.click(`[data-m="${m}"]`);
  await page.waitForTimeout(900);
  const text = (await page.textContent('#panel-body')).trim();
  if (text.length < 20) problems.push(`mode "${m}" rendered an empty panel`);
}

// 4. answering questions advances the session without throwing
await page.click('[data-m="study"]');
await page.waitForTimeout(700);
for (let i = 0; i < 6; i++) {
  const opt = await page.$('#opts .opt');
  if (opt) {
    await opt.click();
    await page.waitForTimeout(350);
    const next = await page.$('#nextq');
    if (next) await next.click();
  } else {
    await page.mouse.click(700, 420);
    await page.waitForTimeout(400);
    const next = await page.$('#nextq');
    if (next) await next.click();
  }
  await page.waitForTimeout(400);
}

// 5. overlays switch without error
for (const ov of ['mastery', 'density', 'language', 'religion', 'region', 'none']) {
  await page.click('[data-m="explore"]');
  await page.click(`[data-ov="${ov}"]`);
  await page.waitForTimeout(250);
}

await browser.close();

if (problems.length) {
  console.error('FAIL\n' + problems.map(p => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log(`PASS — ${MODES.length} modes, dossier, overlays, ${painted} colours sampled`);
