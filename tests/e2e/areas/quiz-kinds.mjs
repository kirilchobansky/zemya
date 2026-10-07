/** Quiz kinds area (dev server): flags, outlines, capitals, currency — each advances on a correct
 *  answer and never shows an answer's name on screen beforehand (the label-leak test). */
import { answer, countryOf, findNameOnPage, startQuiz, typeWrong } from '../lib/quiz.mjs';
import { frames } from '../lib/waits.mjs';

/** The decoded flag <img> must have a real on-screen box, not just a nonzero naturalWidth. */
const flagBox = page =>
  page.evaluate(() => {
    const img = document.querySelector('.quiz-flag-stage__flag img');
    if (!(img instanceof HTMLImageElement)) return null;
    return { complete: img.complete, naturalWidth: img.naturalWidth, clientWidth: img.clientWidth, clientHeight: img.clientHeight };
  });

async function noLeak(page, check, names, when) {
  for (const name of names) {
    const leaks = await findNameOnPage(page, name);
    check(leaks.length === 0, `"${name}" is visible ${when} — ${leaks.join(' | ')}`);
  }
}

async function flags({ page, devBase, check }) {
  const first = await startQuiz(page, `${devBase}quizzes/geography/flags/world/20`, { map: false });
  check(Boolean(first?.target), 'flags quiz exposed no current target after START');
  await page.waitForFunction(() => document.querySelector('.quiz-flag-stage__flag img')?.complete);
  const box = await flagBox(page);
  check(Boolean(box && box.naturalWidth > 0 && box.clientWidth > 0 && box.clientHeight > 0), `the flags quiz's flag image did not render at a real size — ${JSON.stringify(box)}`);
  const next = await answer(page, first.target, first);
  check(next.target !== first.target, 'typing the correct country name did not advance the flags quiz');
  check(next.answeredCount === first.answeredCount + 1, `flags quiz answered count did not increase — ${first.answeredCount} -> ${next.answeredCount}`);
  if (next.target) check(!(await page.textContent('body')).includes(next.target), `the next flag's country name ("${next.target}") is visible somewhere on the page`);
}

async function outlines({ page, devBase, check }) {
  const first = await startQuiz(page, `${devBase}quizzes/geography/outlines/world/20`, { map: false });
  check(Boolean(first?.target), 'outlines quiz exposed no current target after START');
  check(await page.isVisible('.quiz-flag-stage__outline canvas'), 'the outlines quiz drew no silhouette canvas');
  const next = await answer(page, first.target, first);
  check(next.target !== first.target, 'typing the correct name did not advance the outlines quiz');
  if (next.target) check(!(await page.textContent('body')).includes(next.target), `the next outline's country name ("${next.target}") is visible somewhere on the page`);
}

async function capitals({ page, devBase, check }) {
  const first = await startQuiz(page, `${devBase}quizzes/geography/capitals/world/20`);
  check(Boolean(first?.targetCapital), 'capitals quiz exposed no current target capital after START');
  if (!first?.targetCapital) return;
  await noLeak(page, check, [first.targetCapital, first.target], 'on the capitals quiz before it was answered');

  // the COUNTRY's name is not the answer — unless the country deliberately shares its name with
  // its capital's accepted names (Mexico, Panama, Luxembourg, ...); the unit tests pin that
  const fold = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’‘ʼ`]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const country = await countryOf(page, first.target);
  const shares = Boolean(country && country.capitalAliases.some(a => fold(a) === fold(first.target)));
  if (!shares) {
    const after = await typeWrong(page, first.target);
    check(after.answeredCount === first.answeredCount && after.target === first.target, `typing the country's name ("${first.target}") advanced the capitals quiz`);
    await page.fill('.quiz-dock__input', '');
  }

  // positive control — the detector must be able to FAIL: a reveal shows the answer, so the same
  // scan has to find the capital now, or the "not visible" checks around it prove nothing
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.quiz-dock__answer', { state: 'visible', timeout: 5000 });
  check((await findNameOnPage(page, first.targetCapital)).length > 0, 'the leak detector found nothing after a reveal — it cannot be trusted to catch a real leak');

  const next = await answer(page, first.targetCapital, first);
  check(next.target !== first.target, `typing the capital ("${first.targetCapital}") did not advance the capitals quiz`);
  check(next.answeredCount === first.answeredCount + 1, `capitals quiz answered count did not increase — ${first.answeredCount} -> ${next.answeredCount}`);
  // what is on screen NOW: the next target's capital, and the one just answered
  if (next.targetCapital) {
    await frames(page);
    await noLeak(page, check, [next.targetCapital, next.target, first.targetCapital], 'on the capitals quiz after advancing');
  }
}

async function currency({ page, devBase, check }) {
  const first = await startQuiz(page, `${devBase}quizzes/geography/currency/world/20`);
  const target = await countryOf(page, first?.target);
  check(Boolean(target?.currencyName), "currency quiz: could not find the current target's currency");
  if (!target?.currencyName) return;
  await noLeak(page, check, [target.currencyName, target.currencyCode], 'on the currency quiz before it was answered');
  const next = await answer(page, target.currencyName, first);
  check(next.answeredCount === first.answeredCount + 1, `currency quiz answered count did not increase — ${first.answeredCount} -> ${next.answeredCount}`);
}

export async function run(ctx) {
  await flags(ctx);
  await outlines(ctx);
  await capitals(ctx);
  await currency(ctx);
}
