/**
 * One-off import: content/history/source-bg.html's ruler/government tables ->
 * content/history/bg.yaml (this project's hand-authored schema, validated by
 * scripts/lib/history.mjs). Run once; re-running is safe (it re-derives from the
 * source, and throws on any id collision) but not idempotent against a bg.yaml that
 * has since been hand-edited around the inserted sections.
 *
 *   node scripts/import-rulers.mjs
 *
 * Tables imported, each parsed straight out of the HTML (regex, not transcribed by
 * hand) with per-item tier/precision/skip decisions layered on top as data (OVERRIDES,
 * SKIP below) — those judgement calls aren't in the source and can't be parsed out of
 * it:
 *   4.3  Владетелите на Второто царство       -> kind: ruler,      role: цар
 *   8.5  Монарсите на Третото българско царство -> kind: ruler,    role: княз | цар
 *   9.3  Кой всъщност управлява 1946-1989, three parallel columns:
 *          БКП leader   -> kind: ruler,      role: лидер на БКП
 *          глава на държавата -> kind: ruler, role: държавен глава
 *          министър-председател -> kind: government
 *   7.4  Правителствата 1879-1908            -> kind: government
 *   8.6  Правителствата 1911-1946            -> kind: government
 *
 * Tier rule (owner instruction, not derivable from the source): 1 for Иван Асен II,
 * Калоян, Фердинанд I, Борис III and every Живков entry; 2 for other monarchs and
 * party leaders; 3 for short/contested reigns, figurehead heads-of-state and cabinets.
 *
 * Two 9.3 cells duplicate entries already in bg.yaml at finer precision and are
 * skipped (SKIP below): Kimon Georgiev's 1944-1946 governments (already two exact-dated
 * entries from table 8.6) and Georgi Atanasov's 1986-1990 premiership (already
 * pm-atanasov, table 11.3).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, 'content', 'history', 'source-bg.html');
const yamlPath = join(root, 'content', 'history', 'bg.yaml');

const html = readFileSync(htmlPath, 'utf8');
let yamlText = readFileSync(yamlPath, 'utf8');

const existingIds = new Set([...yamlText.matchAll(/^  - id: (\S+)/gm)].map(m => m[1]));

// -- generic helpers, same conventions as scripts/import-events.mjs --------------------

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya'
};

// existing ids spell ordinal rulers with an arabic digit (ruler-boris-1, ruler-petar-1),
// not a roman numeral, so new ids from this import follow the same convention
const ROMAN = { I: '1', II: '2', III: '3', IV: '4' };

function slugify(name) {
  const arabic = name.split(' ').map(w => ROMAN[w] ?? w).join(' ');
  const translit = [...arabic.toLowerCase()].map(ch => TRANSLIT[ch] ?? ch).join('');
  return translit.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
}

function makeId(prefix, name) {
  const base = `${prefix}-${slugify(name)}`;
  let id = base;
  let n = 2;
  while (existingIds.has(id)) id = `${base}-${n++}`;
  existingIds.add(id);
  return id;
}

function yamlQuote(str) {
  return `"${String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function stripTags(htmlFragment) {
  return htmlFragment
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** "5.07.1879" -> "1879-07-05"; also accepts the bare-year form used by table 4.3/8.5. */
function toIsoDate(d, m, y) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const FULL_DATE_RE = /(\d{1,2})\.(\d{1,2})\.(\d{4})/;

/** old for any date before 1 April 1916 (Julian cutover), same rule as import-events.mjs;
 *  a range's style follows its start, same convention as the existing spanning periods
 *  (e.g. period-principality-kingdom, 1878-1946, is "old" though it runs past 1916). */
function isOldStyle(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (y !== 1916) return y < 1916;
  const month = m ?? 1;
  if (month !== 4) return month < 4;
  return (d ?? 1) < 1;
}

/** Parses one "range" cell: either "1185–1197" (years) or "5.07.1879 – 26.11.1879"
 *  (full dates, en-dash separated, open-ended with just "16.01.1908 – "). */
function parseRange(text) {
  const full = [...text.matchAll(new RegExp(FULL_DATE_RE, 'g'))];
  if (full.length >= 1) {
    const [, d1, m1, y1] = full[0];
    const start = toIsoDate(d1, m1, y1);
    if (full.length >= 2) {
      const [, d2, m2, y2] = full[1];
      return { start, end: toIsoDate(d2, m2, y2), precision: 'exact' };
    }
    return { start, end: null, precision: 'exact' };
  }
  const years = [...text.matchAll(/-?\d+/g)].map(m => m[0]);
  if (years.length === 0) throw new Error(`parseRange: no date found in "${text}"`);
  return { start: years[0], end: years[1] ?? null, precision: 'year' };
}

function renderEntry({ id, kind, nameBg, nameEn, aliases = [], role, start, end, precision, style, tier, parent, blurbBg, blurbEn = '' }) {
  const lines = [
    `  - id: ${id}`,
    `    kind: ${kind}`,
    `    name: { bg: ${yamlQuote(nameBg)}, en: ${yamlQuote(nameEn)} }`,
    `    aliases: [${aliases.map(yamlQuote).join(', ')}]`,
    `    role: ${role}`,
    `    start: ${yamlQuote(start)}`
  ];
  if (end) lines.push(`    end: ${yamlQuote(end)}`);
  lines.push(`    precision: ${precision}`, `    style: ${style}`, `    tier: ${tier}`);
  if (parent) lines.push(`    parent: ${parent}`);
  lines.push(`    blurb:`, `      bg: ${yamlQuote(blurbBg)}`, `      en: ${yamlQuote(blurbEn)}`);
  return lines.join('\n');
}

// -- table extraction --------------------------------------------------------------------

/** Returns the raw <tbody>...</tbody> inner HTML following an <h3>heading</h3>. */
function tableAfterHeading(heading) {
  const idx = html.indexOf(`<h3>${heading}`);
  if (idx === -1) throw new Error(`heading not found: ${heading}`);
  const tbodyStart = html.indexOf('<tbody>', idx);
  const tbodyEnd = html.indexOf('</tbody>', tbodyStart);
  if (tbodyStart === -1 || tbodyEnd === -1) throw new Error(`no <tbody> after heading: ${heading}`);
  return html.slice(tbodyStart + '<tbody>'.length, tbodyEnd);
}

/** Splits a <tbody> into rows of raw <td> inner-HTML strings, no rowspan handling
 *  (tables 4.3, 7.4, 8.5, 8.6 — every row is self-contained). */
function simpleRows(tbody) {
  const rows = [...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
  return rows.map(row => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]));
}

/** Splits a <tbody> into full rows of raw <td> inner-HTML, filling any rowspan cell
 *  down into the rows below it (table 9.3 — the only one that uses rowspan). */
function rowspanRows(tbody, numCols) {
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

const blocks = []; // rendered YAML text blocks, in source order, per insertion anchor
const bySection = { second_empire: [], gov_1879_1908: [], monarchs_1879_1946: [], gov_1911_1946: [], communist: [] };

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

for (const [yearsHtml, nameHtml, noteHtml] of simpleRows(tableAfterHeading('4.3 Владетелите на Второто царство'))) {
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
  bySection.second_empire.push(renderEntry({
    id: makeId('ruler', nameBg.replace(/\s*\(.*\)/, '').replace(' / ', ' ')),
    kind: 'ruler', nameBg, nameEn, role: 'цар', start, end, precision, style: 'old', tier, blurbBg
  }));
}

// == 7.4 / 8.6 governments (Principality/Kingdom prime ministers) =======================

function importGovernments(heading, target) {
  for (const [nameHtml, yearsHtml, noteHtml] of simpleRows(tableAfterHeading(heading))) {
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

importGovernments('7.4 Правителствата 1879–1908', bySection.gov_1879_1908);
importGovernments('8.6 Правителствата 1911–1946', bySection.gov_1911_1946);

// == 8.5 Third Kingdom monarchs ===========================================================

const MONARCH_EN = {
  'Александър I Батенберг': 'Alexander I of Battenberg',
  'Фердинанд I': 'Ferdinand I',
  'Борис III': 'Boris III',
  'Симеон II': 'Simeon II'
};
const MONARCH_TIER = { 'Фердинанд I': 1, 'Борис III': 1 };

for (const [nameHtml, yearsHtml, noteHtml] of simpleRows(tableAfterHeading('8.5 Монарсите на Третото българско царство'))) {
  const nameLine = stripTags(nameHtml).split('\n');
  const nameBg = nameLine[0].trim();
  const role = (nameLine[1] ?? 'цар').trim() || 'цар';
  const { start, end, precision } = parseRange(stripTags(yearsHtml));
  const blurbBg = stripTags(noteHtml);
  if (/^Регентство$/i.test(nameBg)) continue; // a 3-person collective regency, not a single ruler entry
  const nameEn = MONARCH_EN[nameBg];
  if (!nameEn) throw new Error(`8.5: no English name mapped for "${nameBg}"`);
  bySection.monarchs_1879_1946.push(renderEntry({
    id: makeId('ruler', nameBg),
    kind: 'ruler', nameBg, nameEn, role, start, end, precision, style: isOldStyle(start) ? 'old' : 'new',
    tier: MONARCH_TIER[nameBg] ?? 2, blurbBg
  }));
}

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

const rows93 = rowspanRows(tableAfterHeading('9.3 Кой всъщност управлява 1946–1989'), 3);

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
    bySection.communist.push(renderEntry({
      id: makeId('ruler', `${item.name}-bkp`),
      kind: 'ruler', nameBg: item.name, nameEn: '', role: 'лидер на БКП',
      start, end, precision, style: 'new', tier: BKP_LEADER_TIER[item.name] ?? 2,
      blurbBg: BLURB_93[`bkp:${item.name}:${start}`] ?? item.note ?? `Лидер на БКП, ${start}${end ? '–' + end : ''}.`
    }));
  }
  for (const item of splitCellEntries(pmHtml)) {
    if (SKIP_PM_NAMES.has(item.name)) continue;
    const { start, end, precision } = parseRange(item.years);
    bySection.communist.push(renderEntry({
      id: makeId('pm', item.name),
      kind: 'government', nameBg: item.name, nameEn: '', role: 'министър-председател',
      start, end, precision, style: 'new', tier: PM_TIER[item.name] ?? 3,
      blurbBg: BLURB_93[`pm:${item.name}:${start}`] ?? item.note ?? `Министър-председател, ${start}${end ? '–' + end : ''}.`
    }));
  }
  for (const item of headFresh ? splitCellEntries(headHtml) : []) {
    if (SKIP_STATE_HEAD_NAMES.has(item.name)) continue;
    const { start, end, precision } = parseRange(item.years);
    bySection.communist.push(renderEntry({
      id: makeId('ruler', `${item.name}-state-head`),
      kind: 'ruler', nameBg: item.name, nameEn: '', role: 'държавен глава',
      start, end, precision, style: 'new', tier: STATE_HEAD_TIER[item.name] ?? 3,
      blurbBg: BLURB_93[`head:${item.name}:${start}`] ?? item.note ?? `Държавен глава, ${start}${end ? '–' + end : ''}.`
    }));
  }
}

// -- splice everything into bg.yaml, chronologically, right after the First Empire
//    rulers section and before "heads of state since 1989" -----------------------------

const sectioned = [
  ['  # ------------------------------------------ Second Empire rulers, 1185-1396 (table 4.3)', bySection.second_empire],
  ['  # --------------------------------------------- governments, 1879-1908 (table 7.4)', bySection.gov_1879_1908],
  ['  # ------------------------------------- monarchs, Third Bulgarian Kingdom (table 8.5)', bySection.monarchs_1879_1946],
  ['  # --------------------------------------------- governments, 1911-1946 (table 8.6)', bySection.gov_1911_1946],
  ['  # ----------------------------- communist-era power structure, 1946-1989 (table 9.3)', bySection.communist]
];

let insertText = '';
for (const [header, entries] of sectioned) {
  insertText += `${header}\n` + entries.join('\n\n') + '\n\n';
}

const anchor = '  # -------------------------------------------------- heads of state since 1989 (11.2)';
if (!yamlText.includes(anchor)) throw new Error('insertion anchor not found in bg.yaml');
yamlText = yamlText.replace(anchor, insertText.trimEnd() + '\n\n' + anchor);

// -- drop the now-done TODO comment ------------------------------------------------------

yamlText = yamlText.replace(
  /# TODO \(later pass, not this one\): Second Empire rulers[\s\S]*?parallel BKP-secretary \/ premier \/ head-of-state tracks\)\.\n#\n/,
  ''
);
if (/# TODO \(later pass, not this one\)/.test(yamlText)) throw new Error('TODO comment still present after replace');

writeFileSync(yamlPath, yamlText, 'utf8');

for (const [header, entries] of sectioned) console.log(`${header.trim()}: ${entries.length}`);
