/**
 * Phone area (dev server, iPhone 13 profile): the bottom sheet, the tab bar, and a quiz run on a
 * touch keyboard's terms. Playwright emulates the viewport and touch but NOT an on-screen keyboard,
 * so what is checked is what does not need one: START focuses the input inside the tap, the input
 * keeps focus through map drags, Skip and Pause, typed answers advance. The keyboard's own
 * behaviour (visualViewport, the bar riding on it) needs a real phone.
 */
import { firstLand } from '../lib/map.mjs';
import { openPhone } from '../lib/phone.mjs';
import { run as runLists } from './phone-lists.mjs';
import { run as runQuiz } from './phone-quiz.mjs';
import { run as runWidths } from './phone-widths.mjs';

async function shellAndSheet(p, devBase, check) {
  const { phone, touchDrag, snapOf, open } = p;
  await open(devBase);
  const shell = await phone.evaluate(() => ({
    vw: window.innerWidth,
    vh: window.innerHeight,
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    shellH: document.querySelector('.shell').getBoundingClientRect().height
  }));
  p.shell = shell;
  check(shell.scrollW === shell.vw, `phone: the page scrolls horizontally (${shell.scrollW} > ${shell.vw})`);
  check(shell.scrollH <= shell.vh && Math.round(shell.shellH) === shell.vh, `phone: the shell is not exactly one viewport tall (${JSON.stringify(shell)})`);
  check(await phone.isVisible('.tabbar'), 'phone: no tab bar');
  check(!(await phone.isVisible('.rail')), 'phone: the desktop rail is still showing');
  check((await snapOf()) === 'peek', `phone: the sheet did not start at peek (${await snapOf()})`);

  // tap a country: selects it, the sheet stays at peek, the camera does not move, no tooltip
  const land = await firstLand(phone, [[85, 250], [200, 260], [330, 260], [250, 330], [130, 330], [300, 300]]);
  check(Boolean(land), 'phone: no land under any probe point — tap-select untested');
  if (!land) return;
  await phone.touchscreen.tap(land.point[0], land.point[1]);
  await phone.waitForURL(/\/country\//, { timeout: 5000 }).catch(() => {});
  check(/\/country\//.test(phone.url()), 'phone: tapping the map never selected a country');
  if (!/\/country\//.test(phone.url())) return;
  await phone.waitForSelector('.panel .peek__title', { timeout: 5000 });
  check((await snapOf()) === 'peek', `phone: selecting on the map moved the sheet off peek (${await snapOf()})`);
  check(!(await phone.isVisible('.tip')), 'phone: a hover tooltip showed on touch');
  check(((await phone.textContent('.panel .peek__title')) || '').trim().length > 0, 'phone: the peek shows no country name');
  const peek = await phone.evaluate(() => {
    const r = document.querySelector('.panel').getBoundingClientRect();
    const t = document.querySelector('.tabbar').getBoundingClientRect();
    return t.top - r.top;
  });
  check(peek > 80 && peek < 100, `phone: peek should show ~88px of sheet above the tab bar, showed ${peek}`);

  // drag the handle up to full, then scroll the content, then drag it back down
  const grip = await phone.locator('.sheet__grip').boundingBox();
  await touchDrag(grip.x + grip.width / 2 - 60, grip.y + 14, 30);
  check((await snapOf()) === 'full', `phone: dragging the handle up did not reach full (${await snapOf()})`);
  const fullTop = await phone.evaluate(() => document.querySelector('.panel').getBoundingClientRect().top);
  check(Math.abs(fullTop - shell.vh * 0.1) < 4, `phone: full should leave 10% of the screen, top was ${fullTop}`);
  // a drag inside scrolled-to-top content at full: up scrolls the content, it must not move the sheet
  await touchDrag(200, 500, 250);
  check((await snapOf()) === 'full', 'phone: scrolling the content moved the sheet');
  check((await phone.evaluate(() => document.querySelector('.panel__body').scrollTop)) > 0, 'phone: the sheet content did not scroll');
  // ...and back at scrollTop 0, a downward drag moves the sheet
  await phone.evaluate(() => { document.querySelector('.panel__body').scrollTop = 0; });
  await touchDrag(200, 250, 560);
  check((await snapOf()) !== 'full', 'phone: dragging down from the top of the content did not lower the sheet');
  // tap the handle to step
  const before = await snapOf();
  await phone.tap('.sheet__grip');
  await phone.waitForFunction(b => document.querySelector('.panel').getAttribute('data-snap') !== b, before, { timeout: 5000 }).catch(() => {});
  check((await snapOf()) !== before, 'phone: tapping the handle did not step the sheet');
}

async function tabsAndStart(p, check) {
  const { phone, snapOf, settled } = p;
  // tabs: Quizzes opens the subject picker at full (/quizzes is a two-stop route: peek and full)
  await phone.tap('.tab:has-text("Quizzes")');
  await phone.waitForURL('**/quizzes', { timeout: 5000 });
  await phone.waitForSelector('.subject-card', { timeout: 5000 });
  await settled();
  check((await snapOf()) === 'full', `phone: the Quizzes tab should open the sheet at full (${await snapOf()})`);

  // pick Geography, expand Name the Country, then start: the run owns the screen
  await phone.tap('.subject-card:has-text("Geography")');
  await phone.waitForURL('**/quizzes/geography', { timeout: 5000 });
  await phone.tap('.quiz-list__row:has-text("Name the Country")');
  await phone.waitForSelector('.quiz-size-card__link', { timeout: 5000 });
  await phone.tap('.quiz-size-card__link');
  await phone.waitForURL(/\/quizzes\/geography\/countries\//, { timeout: 5000 });
  await phone.waitForSelector('.quiz-dock__start', { state: 'visible', timeout: 10000 });
  await settled(); // the sheet slides away over 0.3s, then turns visibility:hidden
  check(!(await phone.isVisible('.tabbar')), 'phone: the tab bar is showing during a quiz');
  check(!(await phone.isVisible('.panel')), 'phone: the sheet is showing during a quiz');
}

export async function run(ctx) {
  const { check, devBase } = ctx;
  const p = await openPhone(ctx);
  try {
    await shellAndSheet(p, devBase, check);
    await tabsAndStart(p, check);
    await runQuiz(ctx, p);
    await runWidths(ctx, p);
    await runLists(ctx, p);
  } finally {
    await p.context.close();
  }
}
