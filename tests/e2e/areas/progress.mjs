/** Progress area (dev server): grading a facet updates the rail and repaints the mastery overlay. */
import { MAP, countryState, flewToCountry, renderedAt } from '../lib/map.mjs';
import { frames, mapIdle, open } from '../lib/waits.mjs';

const tally = page => page.$$eval('.tally__n', els => els.map(e => Number(e.textContent.trim())));

export async function run({ page, devBase, check }) {
  await open(page, devBase);
  await page.waitForFunction(() => Boolean(window.__zemya), null, { timeout: 5000 });

  await page.fill('.search input', 'bulgaria');
  await page.waitForSelector('.search__results img.flag', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForURL('**/country/bulgaria', { timeout: 5000 });
  await flewToCountry(page);

  /* Bulgaria is the flown-to, selected country: find a point over it from what is rendered */
  const box = await page.locator(MAP).boundingBox();
  const candidates = [];
  for (let fx = 0.2; fx <= 0.8; fx += 0.1) for (let fy = 0.25; fy <= 0.75; fy += 0.1) candidates.push([box.x + box.width * fx, box.y + box.height * fy]);
  let bulgariaPoint = null;
  for (const point of candidates) {
    if ((await renderedAt(page, point[0], point[1])).includes('BGR')) { bulgariaPoint = point; break; }
  }
  check(Boolean(bulgariaPoint), 'Bulgaria is not rendered anywhere on the map after flying to it');
  if (!bulgariaPoint) return;

  /* deselect on open ocean so the SELECTED colour stops masking the overlay, while the camera
     (and so bulgariaPoint) stays where it is — nothing about this click may move it */
  const ocean = await (async () => {
    for (const point of candidates.concat([[box.x + 20, box.y + 20], [box.x + 20, box.y + box.height - 20]])) {
      if (!(await renderedAt(page, point[0], point[1])).length) return point;
    }
    return null;
  })();
  check(Boolean(ocean), 'could not find open ocean to deselect on');
  if (ocean) await page.mouse.click(ocean[0], ocean[1]);

  await page.click('.chips button:text-is("Mastery")');
  await page.waitForSelector('.chips button:text-is("Mastery")[aria-pressed="true"]');
  await page.mouse.move(30, 30); // off the map, so nothing is hovered while state is read
  await mapIdle(page);

  const before1 = (await countryState(page, 'BGR')).c;
  const before2 = (await countryState(page, 'BGR')).c;
  check(before1 === before2, `fill state is unstable even with nothing changing — ${before1} vs ${before2}`);

  const tallyBefore = await tally(page);
  /* two `good` grades are enough for a fresh FSRS card to pass its learning steps and graduate */
  await page.evaluate(ids => {
    for (const id of ids) {
      window.__zemya.review(id, 'good');
      window.__zemya.review(id, 'good');
    }
  }, ['geo:BGR:capital', 'geo:BGR:flag', 'geo:BGR:currency']);
  await page.waitForFunction(n => Number(document.querySelectorAll('.tally__n')[1]?.textContent) === n + 1, tallyBefore[1], { timeout: 5000 }).catch(() => {});
  await frames(page);
  const tallyAfter = await tally(page);
  check(
    tallyAfter[1] === tallyBefore[1] + 1 && tallyAfter[2] === tallyBefore[2] - 1,
    `rail counts did not move as expected: ${tallyBefore} -> ${tallyAfter}`
  );

  await mapIdle(page);
  const after = (await countryState(page, 'BGR')).c;
  check(after !== before1, `mastery overlay fill under Bulgaria did not change after grading — stayed ${after}`);
  check(
    (await renderedAt(page, bulgariaPoint[0], bulgariaPoint[1])).includes('BGR'),
    'Bulgaria is not rendered under its own point after the overlay changed'
  );
}
