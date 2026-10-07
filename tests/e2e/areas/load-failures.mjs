/**
 * Load failures (production build): the map survives one failed request per file, a corrupted
 * tile file is refetched, and a failure that does not go away shows the notice with the failed
 * step and a Retry button that works without a page reload. Each case has its own page, without
 * the runner's console watch: aborted requests and logged retries are console errors by design.
 */
import { mapIdle } from '../lib/waits.mjs';

const TILES = '**/data/geography/world.pmtiles';
const COARSE = '**/data/geography/world-coarse.json';
const COUNTRIES = '**/data/geography/countries.json';
const NOTICE = '.compare-hud';

async function freshPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.addInitScript(() => { window.__ZEMYA_PROBE__ = true; });
  return page;
}

/** Counts requests to `pattern` and lets `decide(n)` (1-based) answer each one. */
async function intercept(page, pattern, decide) {
  const seen = { count: 0 };
  await page.route(pattern, route => {
    seen.count++;
    return decide(route, seen.count);
  });
  return seen;
}

const drawnCountries = page =>
  page.evaluate(() => new Set(window.__zemyaGl.queryRenderedFeatures({ layers: ['countries'] }).map(f => f.id ?? f.properties.iso3)).size);

export async function run({ browser, base, check }) {
  /* 1. the first request of each data file fails once: the map still loads, with no notice */
  {
    const page = await freshPage(browser);
    const failFirst = (route, n) => (n === 1 ? route.abort('failed') : route.continue());
    const seen = {
      coarse: await intercept(page, COARSE, failFirst),
      countries: await intercept(page, COUNTRIES, failFirst),
      tiles: await intercept(page, TILES, failFirst)
    };
    await page.goto(`${base}/`);
    await mapIdle(page, 30000);
    check(await drawnCountries(page) >= 40, 'after one failed request per file the map is blank');
    check(await page.locator(NOTICE).count() === 0, 'a notice is still showing after the retries succeeded');
    for (const [name, s] of Object.entries(seen)) check(s.count >= 2, `${name}: the failed request was not retried (${s.count} request)`);
    await page.close();
  }

  /* 2. a corrupted world.pmtiles (200, wrong bytes) is refetched once, and the map loads */
  {
    const page = await freshPage(browser);
    const seen = await intercept(page, TILES, (route, n) =>
      n === 1 ? route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from('<html>not tiles</html>') }) : route.continue());
    await page.goto(`${base}/`);
    await mapIdle(page, 30000);
    check(await drawnCountries(page) >= 40, 'after a corrupted tile file the map is blank');
    check(seen.count === 2, `a corrupted tile file should be refetched exactly once (${seen.count} requests)`);
    check(await page.locator(NOTICE).count() === 0, 'a notice is showing after the tile file was refetched');
    await page.close();
  }

  /* 3. tiles that never arrive: the notice names the step, Retry recovers without a reload */
  {
    const page = await freshPage(browser);
    await page.route(TILES, route => route.abort('failed'));
    await page.goto(`${base}/`);
    await page.waitForSelector(`${NOTICE}[role=alert]`, { timeout: 20000 });
    const text = await page.textContent(`${NOTICE}[role=alert]`);
    check(/map tiles/.test(text) && /world\.pmtiles/.test(text), `the notice does not name the failed step and file: "${text.trim()}"`);
    const navigations = [];
    page.on('framenavigated', f => { if (f === page.mainFrame()) navigations.push(f.url()); });
    await page.unroute(TILES);
    await page.click(`${NOTICE}[role=alert] button`);
    await mapIdle(page, 30000);
    check(await page.locator(NOTICE).count() === 0, 'the notice stayed after Retry succeeded');
    check(await drawnCountries(page) >= 40, 'the map is blank after Retry');
    check(navigations.length === 0, 'Retry reloaded the page');
    await page.close();
  }
}
