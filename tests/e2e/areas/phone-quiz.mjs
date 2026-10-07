/** Phone area, part 2: the START screen and a whole quiz run by touch. */
import { frames, mapIdle, quizPhase, quizStarted } from '../lib/waits.mjs';

export async function run({ check }, p) {
  const { phone, touchDrag, snapOf, inputFocused, shell } = p;
  const state = () => phone.evaluate(() => window.__zemyaQuiz);

  const startBox = await phone.locator('.quiz-dock__start').boundingBox();
  check(
    Math.abs(startBox.x + startBox.width / 2 - shell.vw / 2) < 2 && Math.abs(startBox.y + startBox.height / 2 - shell.vh / 2) < 4,
    `phone: START is not centred on the screen (${JSON.stringify(startBox)})`
  );
  const idleText = await phone.evaluate(() => document.body.innerText);
  check(!/space, or enter|press esc|ctrl/i.test(idleText), 'phone: the quiz screen tells a touch user to press a key');
  check(/tap start/i.test(idleText), 'phone: the quiz screen does not say "Tap START"');
  const inputAttrs = await phone.evaluate(() => {
    const i = document.querySelector('.quiz-dock__input');
    return ['autocomplete', 'autocorrect', 'autocapitalize', 'spellcheck', 'inputmode', 'enterkeyhint'].map(a => `${a}=${i.getAttribute(a)}`).join(' ');
  });
  check(
    inputAttrs === 'autocomplete=off autocorrect=off autocapitalize=none spellcheck=false inputmode=text enterkeyhint=done',
    `phone: the quiz input's attributes are wrong — ${inputAttrs}`
  );

  // Chromium focuses the input from the engine's effect too, so "is it focused" cannot tell a focus
  // inside the tap from one after it — and iOS only opens the keyboard for the former. Record who
  // called focus() on the quiz input: the first call must come from START's handler.
  await phone.evaluate(() => {
    window.__focusStacks = [];
    const original = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args) {
      if (this.classList?.contains('quiz-dock__input')) window.__focusStacks.push(new Error().stack || '');
      return original.apply(this, args);
    };
  });
  await phone.tap('.quiz-dock__start');
  await quizStarted(phone);
  const firstFocusStack = await phone.evaluate(() => window.__focusStacks[0] || '');
  check(/startRun/.test(firstFocusStack), `phone: the quiz input was not focused synchronously inside START's tap handler — first focus() came from:\n${firstFocusStack.split('\n').slice(0, 5).join('\n')}`);
  check(await inputFocused(), 'phone: the input was not focused right after START');
  check(await phone.isVisible('.quiz-hud'), 'phone: no HUD during the run');
  const targets = await phone.evaluate(() => {
    const b = sel => document.querySelector(sel)?.getBoundingClientRect();
    const bar = b('.quiz-controls');
    return { barBottom: bar.bottom, vh: innerHeight,
      buttons: [...document.querySelectorAll('.quiz-dock__btn, .quiz-hud__pause')].map(e => [e.getAttribute('aria-label'), e.offsetWidth, e.offsetHeight]) };
  });
  check(targets.buttons.length === 3, `phone: expected Skip, Reveal and Pause buttons, found ${JSON.stringify(targets.buttons)}`);
  check(targets.buttons.every(([, w, h]) => w >= 44 && h >= 44), `phone: a touch target is under 44x44 — ${JSON.stringify(targets.buttons)}`);
  check(Math.abs(targets.barBottom - targets.vh) < 2, `phone: the input bar is not pinned to the bottom (no keyboard) — ${JSON.stringify(targets)}`);

  // the camera puts the target inside the strip between the HUD and the input bar
  await mapIdle(phone);
  const strip = await phone.evaluate(() => {
    const v = window.__zemyaView();
    return { target: v.target, top: document.querySelector('.quiz-hud').getBoundingClientRect().bottom, bottom: document.querySelector('.quiz-controls').getBoundingClientRect().top };
  });
  check(strip.target && strip.target[1] > strip.top && strip.target[1] < strip.bottom, `phone: the quiz target is outside the strip between HUD and input — ${JSON.stringify(strip)}`);

  // dragging and tapping the map must not blur the input (and so must not close the keyboard)
  await touchDrag(200, 320, 400);
  check(await inputFocused(), 'phone: dragging the map blurred the quiz input');
  await phone.touchscreen.tap(200, 300);
  await frames(phone, 4);
  check(await inputFocused(), 'phone: tapping the map blurred the quiz input');
  check(/\/quizzes\//.test(phone.url()), 'phone: tapping the map during a run navigated away');

  // type an answer with the (focused) input — no locator, so nothing but real focus can receive it
  const first = await state();
  await phone.keyboard.type(first.target, { delay: 8 });
  await phone.waitForFunction(n => window.__zemyaQuiz.answeredCount > n, first.answeredCount, { timeout: 5000 }).catch(() => {});
  const second = await state();
  check(second.answeredCount === first.answeredCount + 1 && second.target !== first.target, `phone: typing "${first.target}" did not advance the quiz`);
  check(await inputFocused(), 'phone: the input lost focus between questions');

  // Skip is a real button and does not steal focus
  await phone.tap('.quiz-dock__btn[aria-label="Skip"]');
  await phone.waitForFunction(t => window.__zemyaQuiz.target !== t, second.target, { timeout: 5000 }).catch(() => {});
  check((await state()).target !== second.target, 'phone: the Skip button did not skip');
  check(await inputFocused(), 'phone: tapping Skip blurred the input');

  // pause / resume / abandon live in the HUD and the pause screen
  await phone.tap('.quiz-hud__pause');
  await phone.waitForSelector('.quiz-pause', { state: 'visible', timeout: 5000 }).catch(() => {});
  check(await phone.isVisible('.quiz-pause'), 'phone: Pause showed no pause screen');
  check(await phone.isVisible('.quiz-pause__btn:has-text("Abandon")'), 'phone: the pause screen has no Abandon');
  await phone.tap('.quiz-pause__btn--primary');
  check((await quizPhase(phone, 'running', 5000).catch(() => null))?.phase === 'running', 'phone: Resume did not resume the run');

  // finish the run: the results open as a full-height sheet
  for (let guard = 0; guard < 60; guard++) {
    const q = await state();
    if (!q || q.phase === 'done' || !q.target) break;
    await phone.keyboard.type(q.target, { delay: 4 });
    await phone.waitForFunction(n => window.__zemyaQuiz.answeredCount > n, q.answeredCount, { timeout: 5000 }).catch(() => {});
  }
  check((await quizPhase(phone, 'done', 5000).catch(() => null))?.phase === 'done', 'phone: the run never reached the results');
  await phone.waitForSelector('.panel .action--primary:has-text("Run it again")', { timeout: 5000 }).catch(() => {});
  await p.settled();
  check((await snapOf()) === 'full', `phone: the results should open as a full-height sheet (${await snapOf()})`);
  check(await phone.isVisible('.panel .action--primary:has-text("Run it again")'), 'phone: no "Run it again" on the results sheet');
  check(!(await inputFocused()), 'phone: the keyboard input is still focused over the results');
  await phone.tap('.panel .action--primary:has-text("Run it again")');
  await quizPhase(phone, 'running', 5000).catch(() => {});
  check(await inputFocused(), 'phone: "Run it again" did not focus the input inside the tap');
}
