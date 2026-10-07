/** Quiz list area (production build): quiz mode hides search and tooltip; scope chips re-derive the
 *  size ladder; the old flat URLs redirect. */
import { firstLand } from '../lib/map.mjs';
import { frames, open } from '../lib/waits.mjs';

export async function run({ page, base, check }) {
  /* quiz mode hides the search box and the map's own hover tooltip */
  await open(page, `${base}/quizzes/geography/countries/world/20`);
  check(!(await page.isVisible('.search')), 'the search box is visible during a quiz run');
  const land = await firstLand(page, [[430, 330], [980, 330], [760, 250], [1150, 430], [520, 560], [880, 620]]);
  check(Boolean(land), 'no land under any probe point — the quiz-mode tooltip check would prove nothing');
  if (land) {
    await page.mouse.move(land.point[0] - 4, land.point[1]);
    await page.mouse.move(land.point[0], land.point[1]);
    await frames(page, 5);
    check(!(await page.isVisible('.tip')), 'the hover tooltip is visible during a quiz run');
  }

  /* chips re-derive the size ladder */
  await open(page, `${base}/quizzes/geography`, { map: false });
  check(!(await page.isVisible('.quiz-sizes')), 'the size ladder is visible before a quiz row is expanded');
  await page.click('.quiz-list__item >> nth=0 >> .quiz-list__row');
  const ladderOf = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.quiz-list__item')[0].querySelectorAll('.quiz-size-card__n')].map(e => e.textContent).join(',')
    );
  await page.waitForSelector('.quiz-size-card__n', { timeout: 5000 });
  check((await ladderOf()) === '20,30,50,90,120,All', `world ladder is ${await ladderOf()}`);
  await page.click('.quiz-list__item >> nth=0 >> .chip:has-text("Oceania")');
  await page.waitForFunction(() => [...document.querySelectorAll('.quiz-list__item')[0].querySelectorAll('.quiz-size-card__n')].length === 1);
  check((await ladderOf()) === 'All', `oceania ladder is ${await ladderOf()}`);
  check(
    (await page.getAttribute('.quiz-list__item >> nth=0 >> .chip:has-text("Oceania")', 'aria-pressed')) === 'true',
    'the Oceania chip does not show as selected'
  );

  /* the old flat /quiz paths redirect to their /quizzes/geography/... equivalent */
  await page.goto(`${base}/quiz`, { waitUntil: 'networkidle' });
  await page.waitForURL(/\/quizzes\/geography$/, { timeout: 5000 }).catch(() => {});
  check(/\/quizzes\/geography$/.test(page.url()), `/quiz did not redirect to /quizzes/geography — at ${page.url()}`);
  await page.goto(`${base}/quiz/flags/50`, { waitUntil: 'networkidle' });
  await page.waitForURL(/\/quizzes\/geography\/flags\/world\/50$/, { timeout: 5000 }).catch(() => {});
  check(/\/quizzes\/geography\/flags\/world\/50$/.test(page.url()), `the pre-scope URL did not redirect to world — at ${page.url()}`);
}
