/** Questions area (production build): answering reveals the memory hook and advances. */
import { open } from '../lib/waits.mjs';

export async function run({ page, base, check }) {
  await open(page, `${base}/study`, { map: false });
  await page.waitForSelector('.quiz__option', { timeout: 5000 }).catch(() => {});
  if (!(await page.isVisible('.quiz__option'))) {
    check(false, '/study rendered no question to answer (is a session ever generated?)');
    return;
  }
  const before = (await page.textContent('.panel__head h2')).trim();
  await page.click('.quiz__option >> nth=0');
  await page.waitForSelector('.hook__label', { timeout: 5000 }).catch(() => {});
  check((await page.textContent('.hook__label').catch(() => '')) === 'Memory hook', 'answering a study question did not reveal the memory hook');
  await page.click('.action--primary:has-text("Next")');
  await page.waitForFunction(h => document.querySelector('.panel__head h2')?.textContent.trim() !== h, before, { timeout: 5000 }).catch(() => {});
  const after = (await page.textContent('.panel__head h2')).trim();
  check(after !== before, `answering did not advance to the next question — stayed on "${before}"`);
}
