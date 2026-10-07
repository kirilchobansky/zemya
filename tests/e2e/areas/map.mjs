/**
 * Map area (production build): the map paints, hover/click hit-test, a click selects without
 * moving the camera, search, the dossier and its flag, neighbour links, overlays, the size
 * comparison tool, cold prerendered loads, Russia's antimeridian, Malta as a shape.
 */
import { MAP, countryState, hostStyle, firstLand, flewToCountry, pagePointOf, renderedAt, sameColour, selectedColour } from '../lib/map.mjs';
import { frames, mapIdle, open } from '../lib/waits.mjs';

const scale = page => page.textContent('.scalebar').then(t => t.trim());

/** A flag <img> is only evidence if it was decoded AND has an on-screen box: naturalWidth alone
 *  stayed nonzero in the exact regression this guards (every flag at zero size because an SVG
 *  with no intrinsic dimensions gives width/height:auto nothing to resolve against). */
async function flagBox(page, selector) {
  await page.waitForFunction(sel => document.querySelector(sel)?.complete, selector, { timeout: 5000 });
  return page.evaluate(sel => {
    const img = document.querySelector(sel);
    return { naturalWidth: img.naturalWidth, clientWidth: img.clientWidth, clientHeight: img.clientHeight };
  }, selector);
}
const hasSize = b => Boolean(b && b.naturalWidth > 0 && b.clientWidth > 0 && b.clientHeight > 0);

export async function run({ page, base, check }) {
  /* 1. the map paints something */
  await open(page, `${base}/`);
  const rendered = await page.evaluate(() => {
    const map = window.__zemyaGl;
    const gl = document.querySelector('canvas.maplibregl-canvas');
    return {
      isWebGl: Boolean(gl?.getContext('webgl2') || gl?.getContext('webgl')),
      countries: new Set(map.queryRenderedFeatures({ layers: ['countries'] }).map(f => f.id ?? f.properties.iso3)).size
    };
  });
  check(rendered.isWebGl, 'the map canvas is not a WebGL canvas');
  check(rendered.countries >= 40, `map looks blank — only ${rendered.countries} countries rendered at the home view`);

  /* 2. a map click selects but leaves the camera alone */
  const restingScale = await scale(page);
  const land = await firstLand(page, [[430, 330], [980, 330], [760, 250], [1150, 430], [520, 560], [880, 620]]);
  check(Boolean(land), 'no land found under any probe point — map click untested');
  if (land) {
    await page.mouse.move(land.point[0] - 4, land.point[1]);
    await page.mouse.move(land.point[0], land.point[1]);
    await page.waitForSelector('.tip', { state: 'visible', timeout: 5000 }).catch(() => {});
    check(await page.isVisible('.tip'), 'hovering a country showed no tooltip');
    await page.mouse.click(land.point[0], land.point[1]);
    await page.waitForURL('**/country/**', { timeout: 5000 });
    await page.waitForSelector('.panel__body .hook__label', { timeout: 5000 }).catch(() => {});
    await mapIdle(page); // a camera move, if there were one, has finished
    const afterClick = await scale(page);
    check(afterClick === restingScale, `map click moved the camera — scale bar went "${restingScale}" -> "${afterClick}"`);
    check((await page.textContent('.panel__body')).includes('Memory hook'), 'map click did not open a dossier');
  }

  /* 3. search finds a country and navigates */
  await page.fill('.search input', 'bulgaria');
  await page.waitForSelector('.search__results img.flag', { timeout: 5000 });
  const searchFlag = await flagBox(page, '.search__results img.flag');
  check(hasSize(searchFlag), `the search dropdown's flag image did not render at a real size — ${JSON.stringify(searchFlag)}`);
  await page.keyboard.press('Enter');
  await page.waitForURL('**/country/bulgaria', { timeout: 5000 });
  // the previous country's dossier is still mounted until the new one renders
  await page.waitForFunction(() => document.querySelector('.panel__body')?.textContent.includes('Sofia'), null, { timeout: 5000 }).catch(() => {});
  const dossier = await page.textContent('.panel__body');
  for (const probe of ['Sofia', 'Eastern Orthodoxy', 'Euro', 'Romania', 'Cyrillic']) {
    check(dossier.includes(probe), `dossier missing "${probe}"`);
  }
  const dossierFlag = await flagBox(page, '.dossier__flag img.flag');
  check(hasSize(dossierFlag), `dossier flag <img> did not render at a real size — ${JSON.stringify(dossierFlag)}`);

  /* 4. the camera actually flew */
  await flewToCountry(page);
  const zoomed = await scale(page);
  check(!/10,000 km/.test(zoomed), `camera did not zoom in — scale still reads "${zoomed}"`);

  /* 5. neighbour links navigate */
  const here = new URL(page.url()).pathname;
  await page.click('.neighbours a');
  await page.waitForURL(url => new URL(url).pathname !== here, { timeout: 5000 }).catch(() => {});
  check(/\/country\/[a-z-]+$/.test(new URL(page.url()).pathname) && new URL(page.url()).pathname !== here, 'neighbour link did not navigate');

  /* 6. overlays switch without error */
  for (const label of ['Density', 'Language', 'Religion', 'Region', 'Terrain']) {
    await page.click(`.chips button:text-is("${label}")`);
    await page.waitForSelector(`.chips button:text-is("${label}")[aria-pressed="true"]`, { timeout: 5000 });
    await mapIdle(page);
  }

  /* 7. size comparison lifts, drags and drops */
  await page.click('.toolbar button:has-text("Compare size")');
  await page.waitForSelector('.compare-hud', { state: 'visible', timeout: 5000 });
  // regression: the host keeps MapLibre's `maplibregl-map` (and the overflow/position it brings) while
  // React changes its own classes — they live on the wrapper now (the pause check is in quiz-run)
  const armed = await hostStyle(page);
  check(armed.hasClass && armed.overflow === 'hidden' && ['relative', 'absolute'].includes(armed.position),
    `arming Compare dropped the map host's MapLibre class/layout: ${JSON.stringify(armed)}`);
  const box = await page.locator(MAP).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 130, { steps: 12 });
  await page.mouse.up();
  await frames(page);
  await page.click('.compare-hud button');
  await page.waitForSelector('.compare-hud', { state: 'hidden', timeout: 5000 }).catch(() => {});
  check(!(await page.isVisible('.compare-hud')), 'compare tool would not put the outline back');

  /* 8. a country page loads cold, prerendered */
  await open(page, `${base}/country/nepal`);
  check((await page.textContent('.panel__body')).includes('Kathmandu'), 'cold load of /country/nepal did not render the dossier');
  check((await page.title()) === 'Nepal — Zemya', `wrong document title on cold load: "${await page.title()}"`);

  /* 9. Russia's antimeridian crossing does not break flyTo */
  await open(page, `${base}/country/russia`);
  await flewToCountry(page);
  const russia = await scale(page);
  check(!/10,000 km/.test(russia), `camera did not zoom into Russia — scale still reads "${russia}"`);

  /* 10. Malta renders as a real shape at its own zoom, not a permanent dot */
  await open(page, `${base}/country/malta`);
  await flewToCountry(page);
  await page.waitForFunction(() => Boolean(window.__zemyaGl.getFeatureState({ source: 'world', sourceLayer: 'countries', id: 'MLT' }).c), null, { timeout: 5000 });
  const maltaState = await countryState(page, 'MLT');
  const selected = await selectedColour(page);
  check(sameColour(maltaState.c, selected), `Malta's fill state is not the selection colour (${selected}) — got ${JSON.stringify(maltaState.c)}`);
  const [mx, my] = await pagePointOf(page, 14.4, 35.9);
  // A pin is not a rendered country polygon: Malta must be rendered under its own centre AND
  // ~40px off it, so what is on screen is a filled shape with extent.
  check((await renderedAt(page, mx, my)).includes('MLT'), 'no Malta polygon is rendered at its centre — it looks like a pin, not a shape');
  check((await renderedAt(page, mx + 40, my)).includes('MLT'), 'Malta has no extent beyond its centre pixel — looks like a pin, not a shape');
}
