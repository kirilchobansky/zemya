import { rowspanRows, tableAfterHeading } from './tables.mjs';
import { parseRange, renderEntry, stripTags } from './helpers.mjs';

// == 9.3 Communist-era power structure ====================================================

// Names already covered elsewhere at finer precision, within a given column of table
// 9.3 — skip re-importing them here rather than duplicating: Kimon Georgiev's two
// 1944-1946 cabinets are already exact-dated entries from table 8.6; Georgi Atanasov's
// 1986-1990 premiership is already pm-atanasov (table 11.3, also exact-dated); Petar
// Mladenov's 1989-1990 headship of state is already pres-mladenov (table 11.2).
const SKIP_PM_NAMES = new Set(['Кимон Георгиев', 'Георги Атанасов']);
const SKIP_STATE_HEAD_NAMES = new Set(['Петър Младенов']);

function splitCellEntries(rawCellHtml) {
  // one or more "Name <span class=yr>range</span>" lines, separated by <br>,
  // each optionally followed by its own "<span class=small>note</span>" line
  const text = rawCellHtml.replace(/<br\s*\/?>/gi, '\n---\n');
  const parts = text.split('\n---\n').map(s => s.trim()).filter(Boolean);
  const items = [];
  for (const part of parts) {
    const isSmallOnly = /^<span class="small">/.test(part.trim());
    if (isSmallOnly && items.length > 0) {
      items[items.length - 1].note = stripTags(part);
      continue;
    }
    const yrMatch = part.match(/<span class="yr">([^<]*)<\/span>/);
    const name = stripTags(part.split('<span')[0]);
    items.push({ name, years: yrMatch ? yrMatch[1] : '', note: null });
  }
  return items;
}

const BKP_LEADER_TIER = { 'Тодор Живков': 1 };
const STATE_HEAD_TIER = { 'Тодор Живков': 1 };
const PM_TIER = { 'Тодор Живков': 1 }; // 3 otherwise (cabinets), per the owner's tier rule

// Hand-authored blurbs (keyed by "column:name:start") — table 9.3 gives only a name and
// a year range per cell, no descriptive last column to lift from, unlike 4.3/7.4/8.5/8.6;
// content drawn from the surrounding 9.1/9.2 narrative in source-bg.html.
const BLURB_93 = {
  'bkp:Георги Димитров:1946': 'Генерален секретар на Коминтерна; връща се от Москва да оглави и партията, и правителството.',
  'bkp:Вълко Червенков:1950': 'Най-суровият сталински етап — трудови лагери в Белене и Ловеч, масови изселвания.',
  'bkp:Тодор Живков:1954': '35 години на власт; свален на пленум на ЦК на 10 ноември 1989 г., ден след падането на Берлинската стена.',
  'bkp:Петър Младенов:1989': 'Оглавява партията в деня на свалянето на Живков; тя се преименува в БСП през април 1990 г.',
  'head:Васил Коларов:1946': 'Председател на Президиума на Народното събрание — формален държавен глава след премиерския пост на Димитров.',
  'head:Георги Дамянов:1950': 'Председател на Президиума на НС по времето на Червенков и ранния Живков.',
  'head:Димитър Ганев:1958': 'Формален държавен глава; реалната власт вече изцяло у Живков.',
  'head:Георги Трайков:1964': 'Последен председател на Президиума на НС, преди поста да се слее с новосъздадения Държавен съвет.',
  'head:Тодор Живков:1971': 'Оглавява новосъздадения Държавен съвет — партийното и държавното ръководство в едни ръце.',
  'pm:Георги Димитров:1946': 'Връща се от Москва след дългогодишно ръководство на Коминтерна, за да оглави правителството.',
  'pm:Васил Коларов:1949': 'Кратко премиерство между Димитров и Червенков.',
  'pm:Вълко Червенков:1950': 'Съчетава партийното и държавното ръководство до Априлския пленум от 1956 г.',
  'pm:Антон Югов:1956': 'Постепенно изтласкан от Живков, който поема и министър-председателския пост през 1962 г.',
  'pm:Тодор Живков:1962': 'Живков поема и правителството — властта е напълно концентрирана в неговите ръце.',
  'pm:Станко Тодоров:1971': 'Министър-председател, докато Живков ръководи страната от новия Държавен съвет.',
  'pm:Гриша Филипов:1981': 'Последното правителство преди Атанасов в епохата на Живков.'
};

/** 9.3: the communist-era BKP leaders, prime ministers and heads of state, appended to `out`. */
export function importCommunist(html, makeId, out) {
  const rows93 = rowspanRows(tableAfterHeading(html, '9.3 Кой всъщност управлява 1946–1989'), 3);

  // A rowspan cell (col 0 and, in one place, col 2) reappears verbatim in every row it
  // spans — dedupe on the raw cell HTML so it only produces one entry, not one per row.
  const seenBkpCell = new Set();
  const seenHeadCell = new Set();

  for (const [bkpHtml, pmHtml, headHtml] of rows93) {
    const bkpFresh = !seenBkpCell.has(bkpHtml);
    seenBkpCell.add(bkpHtml);
    const headFresh = !seenHeadCell.has(headHtml);
    seenHeadCell.add(headHtml);

    for (const item of bkpFresh ? splitCellEntries(bkpHtml) : []) {
      const { start, end, precision } = parseRange(item.years);
      out.push(renderEntry({
        id: makeId('ruler', `${item.name}-bkp`),
        kind: 'ruler', nameBg: item.name, nameEn: '', role: 'лидер на БКП',
        start, end, precision, style: 'new', tier: BKP_LEADER_TIER[item.name] ?? 2,
        blurbBg: BLURB_93[`bkp:${item.name}:${start}`] ?? item.note ?? `Лидер на БКП, ${start}${end ? '–' + end : ''}.`
      }));
    }
    for (const item of splitCellEntries(pmHtml)) {
      if (SKIP_PM_NAMES.has(item.name)) continue;
      const { start, end, precision } = parseRange(item.years);
      out.push(renderEntry({
        id: makeId('pm', item.name),
        kind: 'government', nameBg: item.name, nameEn: '', role: 'министър-председател',
        start, end, precision, style: 'new', tier: PM_TIER[item.name] ?? 3,
        blurbBg: BLURB_93[`pm:${item.name}:${start}`] ?? item.note ?? `Министър-председател, ${start}${end ? '–' + end : ''}.`
      }));
    }
    for (const item of headFresh ? splitCellEntries(headHtml) : []) {
      if (SKIP_STATE_HEAD_NAMES.has(item.name)) continue;
      const { start, end, precision } = parseRange(item.years);
      out.push(renderEntry({
        id: makeId('ruler', `${item.name}-state-head`),
        kind: 'ruler', nameBg: item.name, nameEn: '', role: 'държавен глава',
        start, end, precision, style: 'new', tier: STATE_HEAD_TIER[item.name] ?? 3,
        blurbBg: BLURB_93[`head:${item.name}:${start}`] ?? item.note ?? `Държавен глава, ${start}${end ? '–' + end : ''}.`
      }));
    }
  }
}
