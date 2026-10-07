import { simpleRows, tableAfterHeading } from './tables.mjs';
import { isOldStyle, parseRange, renderEntry, stripTags } from './helpers.mjs';

// == 7.4 / 8.6 governments (Principality/Kingdom prime ministers) =======================

export function importGovernments(html, makeId, heading, target) {
  for (const [nameHtml, yearsHtml, noteHtml] of simpleRows(tableAfterHeading(html, heading))) {
    const nameBg = stripTags(nameHtml);
    if (/без премиер/i.test(nameBg)) continue; // "Government without a PM" — no person to enter
    const { start, end, precision } = parseRange(stripTags(yearsHtml));
    const blurbBg = stripTags(noteHtml);
    target.push(renderEntry({
      id: makeId('pm', nameBg),
      kind: 'government', nameBg, nameEn: '', role: 'министър-председател',
      start, end, precision, style: isOldStyle(start) ? 'old' : 'new', tier: 3, blurbBg
    }));
  }
}

// == 8.5 Third Kingdom monarchs ===========================================================

const MONARCH_EN = {
  'Александър I Батенберг': 'Alexander I of Battenberg',
  'Фердинанд I': 'Ferdinand I',
  'Борис III': 'Boris III',
  'Симеон II': 'Simeon II'
};
const MONARCH_TIER = { 'Фердинанд I': 1, 'Борис III': 1 };

/** 8.5: the Third Kingdom's monarchs, appended to `out`. */
export function importMonarchs(html, makeId, out) {
  for (const [nameHtml, yearsHtml, noteHtml] of simpleRows(tableAfterHeading(html, '8.5 Монарсите на Третото българско царство'))) {
    const nameLine = stripTags(nameHtml).split('\n');
    const nameBg = nameLine[0].trim();
    const role = (nameLine[1] ?? 'цар').trim() || 'цар';
    const { start, end, precision } = parseRange(stripTags(yearsHtml));
    const blurbBg = stripTags(noteHtml);
    if (/^Регентство$/i.test(nameBg)) continue; // a 3-person collective regency, not a single ruler entry
    const nameEn = MONARCH_EN[nameBg];
    if (!nameEn) throw new Error(`8.5: no English name mapped for "${nameBg}"`);
    out.push(renderEntry({
      id: makeId('ruler', nameBg),
      kind: 'ruler', nameBg, nameEn, role, start, end, precision, style: isOldStyle(start) ? 'old' : 'new',
      tier: MONARCH_TIER[nameBg] ?? 2, blurbBg
    }));
  }
}
