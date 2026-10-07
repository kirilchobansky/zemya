/** Table extraction from source-bg.html (regex over <tbody>, no HTML parser). */
/** Returns the raw <tbody>...</tbody> inner HTML following an <h3>heading</h3>. */
export function tableAfterHeading(html, heading) {
  const idx = html.indexOf(`<h3>${heading}`);
  if (idx === -1) throw new Error(`heading not found: ${heading}`);
  const tbodyStart = html.indexOf('<tbody>', idx);
  const tbodyEnd = html.indexOf('</tbody>', tbodyStart);
  if (tbodyStart === -1 || tbodyEnd === -1) throw new Error(`no <tbody> after heading: ${heading}`);
  return html.slice(tbodyStart + '<tbody>'.length, tbodyEnd);
}

/** Splits a <tbody> into rows of raw <td> inner-HTML strings, no rowspan handling
 *  (tables 4.3, 7.4, 8.5, 8.6 — every row is self-contained). */
export function simpleRows(tbody) {
  const rows = [...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
  return rows.map(row => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]));
}

/** Splits a <tbody> into full rows of raw <td> inner-HTML, filling any rowspan cell
 *  down into the rows below it (table 9.3 — the only one that uses rowspan). */
export function rowspanRows(tbody, numCols) {
  const rawRows = [...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
  const pending = Array(numCols).fill(null); // { remaining, content }
  const out = [];
  for (const row of rawRows) {
    const cells = [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(m => {
      const rowspanM = m[1].match(/rowspan="(\d+)"/);
      return { content: m[2], rowspan: rowspanM ? Number(rowspanM[1]) : 1 };
    });
    const full = [];
    let ci = 0;
    for (let col = 0; col < numCols; col++) {
      if (pending[col]) {
        full.push(pending[col].content);
        pending[col].remaining--;
        if (pending[col].remaining <= 0) pending[col] = null;
      } else {
        const cell = cells[ci++];
        full.push(cell.content);
        if (cell.rowspan > 1) pending[col] = { remaining: cell.rowspan - 1, content: cell.content };
      }
    }
    out.push(full);
  }
  return out;
}
