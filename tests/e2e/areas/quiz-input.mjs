/** Quiz input area (dev server): typing survives touching the map — the focus regression test —
 *  and the shortcuts work with focus outside the input. */
import { MAP } from '../lib/map.mjs';
import { startQuiz } from '../lib/quiz.mjs';
import { quiz, quizAnswered, quizMovedOn, quizPhase } from '../lib/waits.mjs';

export async function run({ page, devBase, check }) {
  await startQuiz(page, `${devBase}quizzes/geography/countries/world/30`);
  const box = await page.locator(MAP).boundingBox();
  const activeTag = () => page.evaluate(() => document.activeElement?.tagName ?? 'NONE');

  /** Types the target from an unfocused state, one key at a time like a person, and checks the
   *  run advanced. NO fill(): fill() focuses the element itself, which is what is being tested. */
  async function typeFromUnfocused(label) {
    const before = await quiz(page);
    check((await activeTag()) !== 'INPUT', `${label}: the input still had focus, so this proves nothing`);
    await page.keyboard.type(before.target, { delay: 25 });
    const after = await quizAnswered(page, before.answeredCount + 1, 5000).catch(() => quiz(page));
    check(
      after.answeredCount === before.answeredCount + 1,
      `${label}: typing "${before.target}" with no focus did not advance the run (first letter dropped?) — answered ${before.answeredCount} -> ${after.answeredCount}`
    );
  }

  await page.mouse.click(box.x + 120, box.y + 200); // a plain map click
  await typeFromUnfocused('after a map click');

  await page.mouse.move(box.x + 300, box.y + 300); // a hard drag, then straight to typing
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 180, { steps: 12 });
  await page.mouse.up();
  await typeFromUnfocused('after dragging the map');

  await page.click('button[aria-label="Reset view"]'); // the manual escape hatch: click it, carry on typing
  await typeFromUnfocused('after clicking the reset-view button');

  // shortcuts must still work with focus on a button, i.e. NOT inside the input
  const beforeTab = await quiz(page);
  await page.click('button[aria-label="Reset view"]');
  await page.keyboard.press('Tab');
  const afterTab = await quizMovedOn(page, beforeTab.target).catch(() => quiz(page));
  check(afterTab.target !== beforeTab.target && afterTab.answeredCount === beforeTab.answeredCount, 'Tab with focus outside the input did not skip');
  await page.click('button[aria-label="Reset view"]');
  check(!(await page.isVisible('.quiz-dock__answer')), 'the answer chip was already showing before Ctrl+Enter');
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.quiz-dock__answer', { state: 'visible', timeout: 5000 }).catch(() => {});
  check(await page.isVisible('.quiz-dock__answer'), 'Ctrl+Enter with focus outside the input did not reveal');
  await page.keyboard.press('Escape');
  check((await quizPhase(page, 'paused', 5000).catch(() => null))?.phase === 'paused', 'Esc did not pause');
  await page.keyboard.press('Escape');
  check((await quizPhase(page, 'running', 5000).catch(() => null))?.phase === 'running', 'Esc did not resume');
}
