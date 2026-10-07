/** Driving a quiz run through the DEV test seam (window.__zemyaQuiz) and the real input. */
import { frames, mapIdle, quiz, quizAnswered, quizMovedOn, quizStarted } from './waits.mjs';

/** Opens a quiz URL and presses START; resolves to the first state. `map: false` skips waiting
 *  for the map (the flags and outlines quizzes have none). */
export async function startQuiz(page, url, { map = true } = {}) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.quiz-dock__start', { state: 'visible', timeout: 10000 });
  if (map) await mapIdle(page);
  await page.click('.quiz-dock__start');
  await quizStarted(page);
  return quiz(page);
}

/** Types the whole answer into the run's input and waits for the run to take it. */
export async function answer(page, text, before) {
  await page.fill('.quiz-dock__input', text);
  return quizAnswered(page, before.answeredCount + 1);
}

/** Types `text` and flushes the frames in which a run would have reacted — for asserting that
 *  something was NOT accepted. Returns the state afterwards. */
export async function typeWrong(page, text) {
  await page.fill('.quiz-dock__input', text);
  await frames(page, 4);
  return quiz(page);
}

/** Skips with Tab and waits for the new target. */
export async function skip(page, before) {
  await page.keyboard.press('Tab');
  return quizMovedOn(page, before.target);
}

/**
 * Every text node and human-facing attribute value on the page that contains `name` as a whole
 * word, case-insensitive, diacritic-insensitive. Text nodes only tell half the story — an
 * aria-label or title would leak just as well — and <script>/<style> are skipped, since a bundled
 * data blob is not something a player can read. Returns the offending snippets.
 */
export const findNameOnPage = (page, name) =>
  page.evaluate(wanted => {
    const fold = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const escaped = fold(wanted).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
    const hits = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const tag = node.parentElement?.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') continue;
      if (re.test(fold(node.data))) hits.push(`text: ${node.data.trim().slice(0, 80)}`);
    }
    for (const el of document.body.querySelectorAll('*')) {
      for (const attr of ['aria-label', 'title', 'alt', 'placeholder', 'value']) {
        const v = el.getAttribute(attr);
        if (v && re.test(fold(v))) hits.push(`${el.tagName.toLowerCase()}[${attr}]: ${v.slice(0, 80)}`);
      }
    }
    return hits;
  }, name);

/** The country record (countries.json) named `name`, or null. */
export const countryOf = (page, name) =>
  page.evaluate(async target => {
    const all = await (await fetch('/data/geography/countries.json')).json();
    return all.find(c => c.name === target) ?? null;
  }, name);
