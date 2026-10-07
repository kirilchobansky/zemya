/** Phone area, part 4: the quiz list (one scrolling chip row, three size cards to a row) and the
 *  Questions screen's answer buttons. */

export async function run({ devBase, check }, p) {
  const { phone, open, settled } = p;

  /* region chips are ONE scrolling row, and the size cards are three to a row — both only exist
     once a quiz row is expanded (collapsed by default) */
  await phone.setViewportSize({ width: 390, height: 780 });
  await open(`${devBase}quizzes/geography`, { map: false });
  await phone.tap('.quiz-list__row:has-text("Name the Country")');
  await phone.waitForSelector('.quiz-sizes .quiz-size-card', { timeout: 5000 });
  await settled();
  const catalogue = await phone.evaluate(() => {
    const row = document.querySelector('.quiz-scope');
    const chips = [...row.querySelectorAll('.chip')].map(c => c.getBoundingClientRect().top);
    const sizeGrid = document.querySelector('.quiz-sizes');
    const cards = [...sizeGrid.querySelectorAll('.quiz-size-card')].map(c => c.getBoundingClientRect());
    const link = sizeGrid.querySelector('.quiz-size-card__link').getBoundingClientRect();
    const card = sizeGrid.querySelector('.quiz-size-card').getBoundingClientRect();
    return {
      rowsOfChips: new Set(chips.map(Math.round)).size,
      scrolls: row.scrollWidth > row.clientWidth,
      perRow: cards.filter(c => Math.abs(c.top - cards[0].top) < 2).length,
      linkFillsCard: Math.abs(link.width - card.width) < 1 && Math.abs(link.height - card.height) < 1,
      gridHeight: sizeGrid.getBoundingClientRect().height
    };
  });
  check(catalogue.rowsOfChips === 1 && catalogue.scrolls, `phone: the catalogue's region chips are not one scrolling row — ${JSON.stringify(catalogue)}`);
  check(catalogue.perRow === 3, `phone: the catalogue's size cards are not three per row — ${JSON.stringify(catalogue)}`);
  check(catalogue.linkFillsCard, 'phone: the size card is not entirely its link (the whole card must be the tap target)');
  await phone.tap('.quiz-scope .chip:has-text("Oceania")');
  await phone.waitForSelector('.quiz-scope .chip:has-text("Oceania")[aria-pressed="true"]', { timeout: 5000 });
  await settled();
  const gridAfter = await phone.evaluate(() => document.querySelector('.quiz-sizes').getBoundingClientRect().height);
  check(Math.abs(catalogue.gridHeight - gridAfter) < 1, `phone: choosing a smaller scope reflowed the size grid (${catalogue.gridHeight} -> ${gridAfter})`);

  /* Questions: answer buttons are full width and at least 48px tall */
  await open(`${devBase}study`, { map: false });
  await phone.waitForSelector('.quiz__option', { timeout: 5000 });
  const options = await phone.evaluate(() => {
    const body = document.querySelector('.panel__body').getBoundingClientRect();
    return [...document.querySelectorAll('.quiz__option')].map(o => {
      const r = o.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), body: Math.round(body.width) };
    });
  });
  check(options.length >= 2, 'phone: the study screen showed no answer buttons');
  check(options.every(o => o.h >= 48 && o.w >= o.body - 34), `phone: study answer buttons are not full-width and 48px tall — ${JSON.stringify(options)}`);
}
