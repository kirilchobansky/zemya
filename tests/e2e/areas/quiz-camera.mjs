/**
 * Quiz camera area (dev server): ONE camera path for every new question — a skip from a zoomed-in
 * view returns to the overview exactly as an answer does and every new target ends up on screen;
 * a wrong attempt or a pause is not a new question and never moves the camera; a continent quiz
 * treats the continent as home.
 */
import { MAP, settledCamera, view, wheelZoom } from '../lib/map.mjs';
import { skip, startQuiz } from '../lib/quiz.mjs';
import { frames, open, quiz, quizAnswered, quizPhase, quizStarted } from '../lib/waits.mjs';

const ratio = cam => cam.zoom / cam.home;
const same = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.zoom - b.zoom) < 1e-6 * a.zoom;

/**
 * After a new question: waits until the camera has come down to `maxZoom` (the move toward the new
 * target starts a tick after the question changes, so "idle right now" proves nothing), then until it
 * is idle, and returns it. Without `maxZoom` it only flushes frames and settles — for a question
 * whose camera is not expected to change.
 */
async function afterNewQuestion(page, maxZoom = null) {
  if (maxZoom === null) await frames(page, 2);
  else await page.waitForFunction(z => window.__zemyaView().camera.zoom <= z, maxZoom, { timeout: 10000 }).catch(() => {});
  return settledCamera(page);
}

/** Whether the target's anchor is inside the map, above the input dock. */
async function targetOnScreen(page) {
  const [v, box, dock] = await Promise.all([
    view(page),
    page.locator(MAP).boundingBox(),
    page.locator('.quiz-dock').boundingBox()
  ]);
  const [tx, ty] = v.target;
  return { tx, ty, inView: tx >= 0 && tx <= box.width && ty >= 0 && ty <= (dock ? dock.y : box.y + box.height) - box.y };
}

async function worldQuiz({ page, devBase, check }) {
  // `order=population` is the 30 most populous — a fixed pool of large countries. The default is a
  // random 30, which can draw a micro-state whose camera legitimately zooms IN to make it visible.
  let state = await startQuiz(page, `${devBase}quizzes/geography/countries/world/30?order=population`);
  const zoomed = await wheelZoom(page, 10);
  check(zoomed.zoom > zoomed.home * 8, `the test's own zoom-in did not take — zoom ${ratio(zoomed)}x`);

  let moved = 0;
  let prev = zoomed;
  const seen = [];
  for (let i = 0; i < 14; i++) {
    state = await skip(page, state);
    const cam = await afterNewQuestion(page, zoomed.home * 3);
    const where = await targetOnScreen(page);
    check(where.inView, `after skipping to ${state.target} its anchor is off screen at (${Math.round(where.tx)}, ${Math.round(where.ty)})`);
    // a skip goes through the same code as an answer: back to (near) the overview, not left zoomed in
    // (world/30 is the 30 most populous countries — none micro — so "near" is well under 3x)
    check(ratio(cam) < 3, `skipping to ${state.target} left the camera zoomed in: ${ratio(cam).toFixed(2)}x`);
    if (!same(cam, prev)) moved += 1;
    seen.push(state.target);
    prev = cam;
  }
  check(moved >= 1, `across ${seen.length} skips at 10x the camera never moved (${seen.join(', ')}) — the first should have returned it to the overview`);

  // "leave it alone" is pinned deterministically: a wrong attempt and a pause/resume are not new
  // questions and must not move the camera
  await wheelZoom(page, 10);
  const settled = await settledCamera(page);
  await page.keyboard.type('zzzz', { delay: 20 });
  await page.keyboard.press('Escape');
  await quizPhase(page, 'paused');
  await page.keyboard.press('Escape');
  await quizPhase(page, 'running');
  const still = await afterNewQuestion(page);
  check(same(still, settled), 'a wrong attempt or a pause/resume moved the camera — only a NEW target may');

  // a GUESS from a zoomed-in view sends the camera back to the world view
  check(ratio(still) > 2, `the test's zoom did not survive to the guess — ${ratio(still)}x`);
  const toGuess = (await quiz(page)).target;
  const count = (await quiz(page)).answeredCount;
  await page.fill('.quiz-dock__input', ''); // the wrong attempt above is still in the field
  await page.keyboard.type(toGuess, { delay: 25 });
  await quizAnswered(page, count + 1);
  const afterGuess = await afterNewQuestion(page, zoomed.home * 3);
  check(ratio(afterGuess) < 3, `answering "${toGuess}" while zoomed in left the camera at ${ratio(afterGuess).toFixed(2)}x, not the world view`);

  // ...and a SKIP from the same zoomed-in view lands in the same place (one code path)
  const zoomedForSkip = await wheelZoom(page, 10);
  check(ratio(zoomedForSkip) > 2, `the test's zoom before the skip did not take — ${ratio(zoomedForSkip)}x`);
  await skip(page, await quiz(page));
  const afterSkip = await afterNewQuestion(page, zoomed.home * 3);
  check(ratio(afterSkip) < 3, `skipping while zoomed in left the camera at ${ratio(afterSkip).toFixed(2)}x — a skip must return the view exactly as an answer does`);
}

async function continentQuiz({ page, devBase, check }) {
  await open(page, `${devBase}quizzes/geography/countries/europe/all`);
  // before START the camera is already on the continent, behind the start dock
  const idle = (await view(page)).camera;
  check(ratio(idle) > 1.5, `the Europe quiz page left the camera at ${ratio(idle).toFixed(2)}x, not the continent view`);
  await page.click('.quiz-dock__start');
  await quizStarted(page);
  const home = await afterNewQuestion(page);
  check(ratio(home) > 1.2, `Europe quiz START left the camera at ${ratio(home).toFixed(2)}x, not the continent view`);

  const zoomedIn = await wheelZoom(page, 4, { from: home.zoom });
  check(zoomedIn.zoom > home.zoom * 2, `the Europe test's own zoom-in did not take — ${zoomedIn.zoom / home.zoom}x`);
  const before = await quiz(page);
  await page.fill('.quiz-dock__input', '');
  await page.keyboard.type(before.target, { delay: 25 });
  const next = await quizAnswered(page, before.answeredCount + 1);
  const micro = ['Andorra', 'Liechtenstein', 'Monaco', 'Malta', 'San Marino', 'Vatican City', 'Luxembourg'].includes(next.target);
  const after = await afterNewQuestion(page, micro ? null : zoomedIn.zoom * 0.5);
  // back to the continent (a target that doesn't fit may zoom out a little further), never left
  // zoomed in and never sent to the whole world; a micro-state target legitimately zooms IN past
  // the continent view (its size is guaranteed)
  check(
    (micro || after.zoom < zoomedIn.zoom * 0.5) && ratio(after) > 1.2,
    `answering "${before.target}" in a Europe quiz left the camera at ${ratio(after).toFixed(2)}x home (zoomed-in was ${(zoomedIn.zoom / after.home).toFixed(2)}x)`
  );
}

export async function run(ctx) {
  await worldQuiz(ctx);
  await continentQuiz(ctx);
}
