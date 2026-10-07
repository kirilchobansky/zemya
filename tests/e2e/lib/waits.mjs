/**
 * Deterministic waits. Nothing in the suite sleeps for a fixed time to "let something finish":
 * it waits for the condition that proves it finished (a URL, a DOM node, the MapLibre instance
 * reporting idle, a quiz-state change), or — to prove something did NOT happen — flushes the
 * frames in which it would have happened and then looks.
 */

/** Resolves after `n` animation frames — what "nothing happened" is asserted after. */
export function frames(page, n = 3) {
  return page.evaluate(
    count => new Promise(resolve => {
      let left = count;
      const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
    n
  );
}

/** Waits for the MapLibre probe (window.__zemyaGl) to exist, then for the map to be completely
 *  idle: style and tiles loaded, no camera movement (our own easeTo included), for a few
 *  consecutive frames — so a move that starts one tick after the trigger is still caught. */
export async function mapIdle(page, timeout = 20000) {
  await page.waitForFunction(() => Boolean(window.__zemyaGl), null, { timeout });
  await page.waitForFunction(
    () => new Promise(resolve => {
      const map = window.__zemyaGl;
      let calm = 0;
      const tick = () => {
        calm = map.isStyleLoaded() && map.areTilesLoaded() && !map.isMoving() ? calm + 1 : 0;
        if (calm >= 4) resolve(true);
        else requestAnimationFrame(tick);
      };
      tick();
    }),
    null,
    { timeout }
  );
}

/** Goes to `url` and waits for the page to be quiet: network idle, then the map idle. */
export async function open(page, url, { map = true } = {}) {
  await page.goto(url, { waitUntil: 'networkidle' });
  if (map) await mapIdle(page);
}

/** Waits until the quiz seam reports a target (a run has started). */
export function quizStarted(page, timeout = 10000) {
  return page.waitForFunction(() => Boolean(window.__zemyaQuiz && window.__zemyaQuiz.target), null, { timeout });
}

/** Waits until a run has answered at least `count` questions; resolves to the quiz state. */
export async function quizAnswered(page, count, timeout = 10000) {
  const handle = await page.waitForFunction(
    n => (window.__zemyaQuiz && window.__zemyaQuiz.answeredCount >= n ? window.__zemyaQuiz : false),
    count,
    { timeout }
  );
  return handle.jsonValue();
}

/** Waits until the run's target is no longer `from` (a skip, an answer); resolves to the state. */
export async function quizMovedOn(page, from, timeout = 10000) {
  const handle = await page.waitForFunction(
    name => (window.__zemyaQuiz && window.__zemyaQuiz.target && window.__zemyaQuiz.target !== name ? window.__zemyaQuiz : false),
    from,
    { timeout }
  );
  return handle.jsonValue();
}

/** Waits for the run to be in `phase` ('running', 'paused', 'done'); resolves to the state. */
export async function quizPhase(page, phase, timeout = 10000) {
  const handle = await page.waitForFunction(
    p => (window.__zemyaQuiz && window.__zemyaQuiz.phase === p ? window.__zemyaQuiz : false),
    phase,
    { timeout }
  );
  return handle.jsonValue();
}

export const quiz = page => page.evaluate(() => window.__zemyaQuiz);
