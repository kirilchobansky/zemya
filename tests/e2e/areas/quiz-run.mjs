/** Quiz run area (dev server): answering advances and never leaks the next name; pause/resume;
 *  the results screen and the personal best. */
import { answer, startQuiz } from '../lib/quiz.mjs';
import { hostStyle } from '../lib/map.mjs';
import { frames, quiz, quizPhase } from '../lib/waits.mjs';

export async function run({ page, devBase, check }) {
  const first = await startQuiz(page, `${devBase}quizzes/geography/countries/world/20`);
  check(Boolean(first?.target), 'quiz exposed no current target after START');

  const second = await answer(page, first.target, first);
  check(second.target !== first.target, 'typing the correct name did not advance the quiz');
  check(second.answeredCount === first.answeredCount + 1, `answered count did not increase — ${first.answeredCount} -> ${second.answeredCount}`);
  // the regression test for the leak: the NEXT target's name must appear nowhere on the page
  if (second.target) {
    check(!(await page.textContent('body')).includes(second.target), `the next target's name ("${second.target}") is visible somewhere on the page`);
  }

  /* pausing freezes the timer; Esc (not just the button) resumes it */
  await page.keyboard.press('Escape');
  const paused = await quizPhase(page, 'paused');
  // regression: the pause blur is a React class — it must not rewrite MapLibre's own class on the host
  const pausedHost = await hostStyle(page);
  check(pausedHost.hasClass && pausedHost.overflow === 'hidden' && ['relative', 'absolute'].includes(pausedHost.position),
    `pausing dropped the map host's MapLibre class/layout: ${JSON.stringify(pausedHost)}`);
  check(await page.locator('.stage__canvas.is-quiz-paused').count() === 1, 'pausing did not blur the map wrapper (is-quiz-paused)');
  await frames(page, 30); // half a second of frames while paused — elapsedMs must not move
  const stillPaused = await quiz(page);
  check(stillPaused.elapsedMs === paused.elapsedMs, `timer kept moving while paused — ${paused.elapsedMs} -> ${stillPaused.elapsedMs}`);
  await page.keyboard.press('Escape'); // used to do nothing: the input was disabled, so unfocusable
  const resumed = await quizPhase(page, 'running').catch(() => null);
  check(resumed?.phase === 'running', 'a second Esc did not resume the run');
  check(
    typeof resumed?.elapsedMs === 'number' && resumed.elapsedMs >= paused.elapsedMs,
    `resuming reset the timer instead of continuing it — paused at ${paused.elapsedMs}, resumed at ${resumed?.elapsedMs}`
  );

  /* finishing a run shows the results screen and records a personal best */
  let guard = 0;
  for (let state = await quiz(page); guard++ < 25 && state && state.phase !== 'done' && state.target; state = await quiz(page)) {
    await page.fill('.quiz-dock__input', state.target);
    await page.waitForFunction(n => window.__zemyaQuiz.answeredCount > n, state.answeredCount, { timeout: 10000 });
  }
  const finished = await quizPhase(page, 'done').catch(() => null);
  check(finished?.phase === 'done', `run did not reach "done" after ${guard} answers`);
  if (!finished) return;

  await page.waitForSelector('.panel__body', { timeout: 5000 });
  const resultText = await page.textContent('.panel__body');
  check(/personal best/i.test(resultText), 'results screen missing the personal best line');
  check(/first-try/.test(resultText), 'results screen missing the first-try/revealed tally');
  check(!(await page.isVisible('.quiz-dock')), 'the input dock is still visible after finishing');

  await page.click('.action--primary:has-text("Try again")');
  const restarted = await quizPhase(page, 'running').catch(() => null);
  check(restarted?.phase === 'running', '"Try again" did not start a new run');

  /* the size grid (and so the best-time badge) only renders once the quiz row is expanded */
  await page.goto(`${devBase}quizzes/geography`, { waitUntil: 'networkidle' });
  await page.click('.quiz-list__row:has-text("Name the Country")');
  await page.waitForSelector('.quiz-size-card__n', { timeout: 5000 });
  // the badge arrives after the rows render: the best time is read from IndexedDB
  await page.waitForFunction(() => /\d:\d\d\.\d/.test(document.querySelector('.panel__body')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
  check(/\d:\d\d\.\d/.test(await page.textContent('.panel__body')), 'the quiz list shows no personal best time after a finished run');
}
