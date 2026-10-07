/**
 * Browser history (production build): a new place pushes an entry, the state of the same place
 * replaces it, so Back does what a person expects. `history.state.idx` is React Router's own
 * position in the stack: it moves by one for a push and not at all for a replace.
 */
import { firstLand } from '../lib/map.mjs';
import { mapIdle, open } from '../lib/waits.mjs';

const idx = page => page.evaluate(() => window.history.state?.idx ?? null);
const path = page => new URL(page.url()).pathname;

export async function run({ page, base, check }) {
  /* 1. opening a country pushes one entry; clicking the same country again adds none; Back returns to the map */
  await open(page, `${base}/`);
  const homeIdx = await idx(page);
  const land = await firstLand(page, [[430, 330], [980, 330], [760, 250], [1150, 430], [520, 560], [880, 620]]);
  check(Boolean(land), 'no land found under any probe point — history stack untested');
  if (land) {
    await page.mouse.click(land.point[0], land.point[1]);
    await page.waitForURL('**/country/**', { timeout: 5000 });
    await mapIdle(page);
    const countryPath = path(page);
    check(await idx(page) === homeIdx + 1, 'opening a country did not push exactly one history entry');
    await page.mouse.click(land.point[0], land.point[1]);
    await mapIdle(page);
    check(path(page) === countryPath && await idx(page) === homeIdx + 1, 'clicking the same country again pushed a duplicate entry');
    await page.goBack();
    await page.waitForURL(u => u.pathname === '/', { timeout: 5000 });
    check(path(page) === '/', `Back from a country did not return to the map (${path(page)})`);
  }

  /* 2. a quiz run: START and Restart (twice) add no entries, and one Back leaves the run for the quiz list */
  await open(page, `${base}/quizzes/geography`, { map: false });
  const listIdx = await idx(page);
  await page.click('.quiz-list__row:has-text("Name the Country")');
  await page.click('.quiz-size-card__n >> nth=0');
  await page.waitForURL('**/quizzes/geography/countries/**', { timeout: 5000 });
  await page.waitForSelector('.quiz-dock__start', { state: 'visible', timeout: 10000 });
  await mapIdle(page);
  check(await idx(page) === listIdx + 1, 'opening a quiz run did not push exactly one history entry');
  await page.click('.quiz-dock__start');
  for (let i = 0; i < 2; i++) {
    await page.click('.panel__body button:has-text("Restart")');
    await page.waitForSelector('.panel__body button:has-text("Restart")', { timeout: 5000 });
  }
  check(await idx(page) === listIdx + 1, `Restart pushed history entries (${await idx(page)} vs ${listIdx + 1})`);
  await page.goBack();
  await page.waitForURL(u => u.pathname === '/quizzes/geography', { timeout: 5000 });
  check(await idx(page) === listIdx, 'one Back from a restarted run did not land on the quiz list');

  /* 3. abandoning a run replaces its entry: the stack is no deeper than before the run */
  await page.click('.quiz-list__row:has-text("Name the Country")');
  await page.click('.quiz-size-card__n >> nth=0');
  await page.waitForURL('**/quizzes/geography/countries/**', { timeout: 5000 });
  await page.waitForSelector('.quiz-dock__start', { state: 'visible', timeout: 10000 });
  await page.click('.quiz-dock__start');
  await page.click('.panel__body button:has-text("Abandon")');
  await page.waitForURL(u => u.pathname === '/quizzes/geography', { timeout: 5000 });
  check(await idx(page) === listIdx + 1, 'abandoning a run pushed an entry instead of replacing the run');

  /* 4. History: country list -> timeline pushes one entry, Back returns to the list */
  await open(page, `${base}/history`, { map: false });
  const historyIdx = await idx(page);
  await page.click('.subject-card >> nth=0');
  await page.waitForURL('**/history/*', { timeout: 5000 });
  check(await idx(page) === historyIdx + 1, 'opening a History country did not push exactly one entry');
  await page.goBack();
  await page.waitForURL(u => u.pathname === '/history', { timeout: 5000 });
  check(path(page) === '/history', 'Back from a History timeline did not return to the country list');
}
