/** History area (production build): the timelines draw, and a fill-the-list quiz mounts. */
import { frames, open } from '../lib/waits.mjs';

const TIMELINE = 'canvas.stage__canvas[aria-label="History timeline"]';

async function timelineIsDrawn(page, base, check, slug) {
  await open(page, `${base}/history/${slug}`, { map: false });
  await page.waitForSelector(`${TIMELINE}:not(.is-hidden)`, { timeout: 10000 }).catch(() => {});
  const box = await page.locator(TIMELINE).boundingBox();
  check(Boolean(box && box.width > 300 && box.height > 300), `/history/${slug}: the timeline canvas has no real size — ${JSON.stringify(box)}`);
  check((await page.title()).length > 0 && !/^Zemya$/.test(await page.title()), `/history/${slug}: no page-specific title (${await page.title()})`);
  // the canvas must have painted something: a blank (transparent) canvas reads all-zero pixels
  await frames(page, 3);
  const painted = await page.evaluate(sel => {
    const c = document.querySelector(sel);
    const g = c.getContext('2d');
    const { data } = g.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 0) return true;
    return false;
  }, TIMELINE);
  check(painted, `/history/${slug}: the timeline canvas is blank`);
}

export async function run({ page, base, check }) {
  
  await timelineIsDrawn(page, base, check, 'bulgaria');
  await timelineIsDrawn(page, base, check, 'united-states');

  /* a fill-the-list quiz page mounts running: an input and a Give up button (no START) */
  await open(page, `${base}/quizzes/history/bulgaria/bulgaria-rulers-first-empire`, { map: false });
  await page.waitForSelector('.fill-quiz__input', { state: 'visible', timeout: 10000 }).catch(() => {});
  check(await page.isVisible('.fill-quiz__input'), 'the History fill quiz page shows no input');
  check(await page.isVisible('.fill-quiz__giveup'), 'the History fill quiz page shows no Give up button');
}
