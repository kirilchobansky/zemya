import { simpleRows, tableAfterHeading } from './tables.mjs';
import { parseRange, renderEntry, stripTags } from './helpers.mjs';

// == 4.3 Second Empire rulers ============================================================

const SECOND_EMPIRE_EN = {
  'Петър IV (Теодор-Петър)': 'Peter IV (Theodore-Peter)',
  'Асен I': 'Asen I',
  'Калоян': 'Kaloyan',
  'Борил': 'Boril',
  'Иван Асен II': 'Ivan Asen II',
  'Калиман I Асен': 'Kaliman I Asen',
  'Михаил II Асен': 'Mihail II Asen',
  'Калиман II / Мицо Асен': 'Kaliman II / Mitso Asen',
  'Константин Тих Асен': 'Konstantin Tih Asen',
  'Ивайло': 'Ivaylo',
  'Иван Асен III': 'Ivan Asen III',
  'Георги I Тертер': 'Georgi I Terter',
  'Смилец': 'Smilets',
  'Чака': 'Chaka',
  'Теодор Светослав': 'Teodor Svetoslav',
  'Георги II Тертер': 'Georgi II Terter',
  'Михаил III Шишман': 'Mihail III Shishman',
  'Иван Стефан': 'Ivan Stefan',
  'Иван Александър': 'Ivan Alexander',
  'Иван Шишман': 'Ivan Shishman',
  'Иван Срацимир': 'Ivan Sratsimir'
};

// tier 1 explicit; tier 3 for short (<=2y) or explicitly "оспорвани" (contested) reigns;
// tier 2 otherwise (default for "other monarchs" per the owner's rule)
const SECOND_EMPIRE_TIER = { 'Калоян': 1, 'Иван Асен II': 1 };
const SECOND_EMPIRE_DISPUTED = new Set(['Калиман II / Мицо Асен']);

/** 4.3: the Second Empire's rulers, appended to `out`. */
export function importSecondEmpire(html, makeId, out) {
  for (const [yearsHtml, nameHtml, noteHtml] of simpleRows(tableAfterHeading(html, '4.3 Владетелите на Второто царство'))) {
    const nameBg = stripTags(nameHtml);
    const { start, end, precision: parsedPrecision } = parseRange(stripTags(yearsHtml));
    const blurbBg = stripTags(noteHtml);
    const startYear = Number(start);
    const endYear = end ? Number(end) : startYear;
    const short = endYear - startYear <= 2;
    const disputed = SECOND_EMPIRE_DISPUTED.has(nameBg);
    const tier = SECOND_EMPIRE_TIER[nameBg] ?? (short || disputed ? 3 : 2);
    const precision = disputed ? 'disputed' : parsedPrecision;
    const nameEn = SECOND_EMPIRE_EN[nameBg];
    if (!nameEn) throw new Error(`4.3: no English name mapped for "${nameBg}"`);
    out.push(renderEntry({
      id: makeId('ruler', nameBg.replace(/\s*\(.*\)/, '').replace(' / ', ' ')),
      kind: 'ruler', nameBg, nameEn, role: 'цар', start, end, precision, style: 'old', tier, blurbBg
    }));
  }
}
