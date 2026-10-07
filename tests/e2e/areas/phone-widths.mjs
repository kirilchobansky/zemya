/** Phone area, part 3: no screen scrolls sideways at the three common phone widths — the document,
 *  the sheet's content and the overlay sheets. Elements drawn beyond the right edge count too: a
 *  clipped button is as broken as a scrollbar. */

const overflowReport = phone =>
  phone.evaluate(() => {
    const vw = window.innerWidth;
    const scroller = [...document.querySelectorAll('.panel__body, .ovl__body')]
      .filter(e => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1)
      .map(e => `${e.className} ${e.scrollWidth}>${e.clientWidth}`);
    const beyond = [...document.querySelectorAll('.panel *, .ovl *, .hud *, .tabbar *')]
      .filter(e => {
        if (e.closest('.quiz-scope')) return false; // the chip row scrolls on purpose
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.right > vw + 1 || r.left < -1);
      })
      .slice(0, 3)
      .map(e => `${e.tagName}.${e.className} right=${Math.round(e.getBoundingClientRect().right)}`);
    return { docW: document.documentElement.scrollWidth, vw, scroller, beyond };
  });

export async function run({ devBase, check }, p) {
  const { phone, open, snapOf, settled } = p;
  const fits = r => r.docW === r.vw && !r.scroller.length && !r.beyond.length;

  for (const width of [360, 390, 430]) {
    await phone.setViewportSize({ width, height: 780 });
    for (const [label, path, snap] of [
      ['home', '', 'peek'],
      ['country', 'country/united-arab-emirates', 'full'],
      ['country (micro-state)', 'country/saint-vincent-and-the-grenadines', 'full'],
      ['catalogue', 'quiz', 'full'],
      ['study', 'study', 'full']
    ]) {
      await open(`${devBase}${path}`, { map: false });
      await phone.waitForSelector('.panel', { timeout: 5000 });
      if (snap === 'full') {
        for (let i = 0; i < 4 && (await snapOf()) !== 'full'; i++) {
          await phone.tap('.sheet__grip');
          await settled();
        }
      }
      const r = await overflowReport(phone);
      check(fits(r), `phone ${width}px, ${label}: something scrolls or sits off-screen sideways — ${JSON.stringify(r)}`);
    }
    for (const [label, opener, sheet] of [['layers', '.layers-btn', '.ovl'], ['progress', '.tab:has-text("Progress")', '.ovl']]) {
      await open(devBase, { map: false });
      await phone.tap(opener);
      await phone.waitForSelector(sheet, { state: 'visible', timeout: 5000 });
      await settled();
      const r = await overflowReport(phone);
      check(fits(r), `phone ${width}px, ${label} sheet: something scrolls or sits off-screen sideways — ${JSON.stringify(r)}`);
    }
    for (const path of ['quizzes/geography/countries/europe/all', 'quizzes/geography/flags/europe/all']) {
      await open(`${devBase}${path}`, { map: false });
      await phone.waitForSelector('.quiz-dock__start', { state: 'visible', timeout: 10000 });
      const docW = await phone.evaluate(() => document.documentElement.scrollWidth);
      check(docW === width, `phone ${width}px, ${path}: the document is ${docW}px wide`);
    }
  }
}
