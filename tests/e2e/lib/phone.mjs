/** The iPhone 13 profile (touch, DPR 3, 390x664) and the touch input Playwright does not wrap. */
import { frames, mapIdle } from './waits.mjs';

/** Opens a phone context on its own page, wired to the shared problem list. The page sets the
 *  MapLibre probe so the area can ask the map what it renders, like the desktop areas. */
export async function openPhone({ browser, devices, watch }) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const phone = await context.newPage();
  await phone.addInitScript(() => { window.__ZEMYA_PROBE__ = true; });
  watch(phone, 'phone ');
  const cdp = await context.newCDPSession(phone);

  /** Waits for every running CSS transition/animation (a sheet snapping) to finish. */
  const settled = async () => {
    await frames(phone, 2);
    await phone.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'), null, { timeout: 5000 });
  };

  /** A one-finger vertical touch drag at x, from y0 to y1, as real touch events. */
  async function touchDrag(x, y0, y1, steps = 14) {
    const send = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await send('touchStart', y0);
    for (let i = 1; i <= steps; i++) {
      await send('touchMove', y0 + ((y1 - y0) * i) / steps);
      await frames(phone, 1);
    }
    await send('touchEnd', y1);
    await settled();
  }

  /** Goes to `url` and waits until the page is quiet (the map too, when `map`). */
  async function open(url, { map = true } = {}) {
    await phone.goto(url, { waitUntil: 'networkidle' });
    if (map) await mapIdle(phone);
  }

  return {
    context,
    phone,
    touchDrag,
    settled,
    open,
    snapOf: () => phone.getAttribute('.panel', 'data-snap'),
    inputFocused: () => phone.evaluate(() => document.activeElement === document.querySelector('.quiz-dock__input'))
  };
}
