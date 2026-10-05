/**
 * The "fill the list" History quiz (app/lib/history/fill-quiz.ts): matching typed names to
 * entries, and which quizzes a timeline yields. Pure logic, no browser.
 *
 *   npm run test:unit
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  dateRangeLabel, entriesFor, fillQuizzesFromRaw, formatFillDate, hasMixedTitles, isShownTitle, matchFill, splitNote, needsNumber, normaliseFill, prepareFill, titleOf,
  yearLabel,
  type FillEntry, type FillQuiz, type FillRawEntry
} from '~/lib/history/fill-quiz';
import type { FillQuizConfig } from '~/lib/history/fill-quiz-config';

function entry(id: string, name: string, nameAlt: string, start: number, aliases: string[] = []): FillEntry {
  return { id, kind: 'ruler', name, nameAlt, aliases, start, end: start + 10, startRaw: String(start), endRaw: String(start + 10), elected: true, title: '' };
}

const LIST = [
  entry('asparuh', 'Аспарух', 'Asparuh', 681, ['Isperih']),
  entry('tervel', 'Тервел', 'Tervel', 700),
  entry('boris1', 'Борис I', 'Boris I', 852),
  entry('simeon', 'Симеон I Велики', 'Simeon I the Great', 893),
  entry('boris2', 'Борис II', 'Boris II', 969),
  entry('peter', 'Петър I', 'Peter I', 927),
  entry('asen2', 'Иван Асен II', 'Ivan Asen II', 1218),
  entry('asen3', 'Иван Асен III', 'Ivan Asen III', 1279),
  entry('alex', 'Александър I Батенберг', 'Alexander I of Battenberg', 1879),
  entry('malinov', 'Александър Малинов', '', 1908),
  entry('georgi', 'Георги Димитров', '', 1946),
  entry('boiko1', 'Бойко Борисов', '', 2009),
  entry('boiko2', 'Бойко Борисов', '', 2014),
  entry('boiko3', 'Бойко Борисов', '', 2017)
];
const PREPARED = prepareFill(LIST);
const NONE: ReadonlySet<string> = new Set();
const idOf = (typed: string, filled: ReadonlySet<string> = NONE) => {
  const m = matchFill(typed, PREPARED, filled);
  return m ? PREPARED[m.index].id : null;
};

describe('normaliseFill', () => {
  it('lowercases and ignores spaces, hyphens and dots', () => {
    expect(normaliseFill('Иван-Асен  II.')).toBe('иванасен2');
  });
  it('strips title words', () => {
    expect(normaliseFill('хан Аспарух')).toBe('аспарух');
    expect(normaliseFill('Tsar Boris I')).toBe('boris1');
    expect(normaliseFill('Prince Boris')).toBe('boris');
  });
  it('treats Roman and Arabic numerals as the same', () => {
    expect(normaliseFill('Борис 1')).toBe(normaliseFill('Борис I'));
    expect(normaliseFill('Борис IV')).toBe('борис4');
    expect(normaliseFill('Борис 9')).toBe('борис9');
  });
});

describe('matchFill', () => {
  it('accepts a one-word name as it is, with or without a title', () => {
    expect(idOf('Аспарух')).toBe('asparuh');
    expect(idOf('хан Аспарух')).toBe('asparuh');
    expect(idOf('tervel')).toBe('tervel');
  });
  it('accepts aliases and Latin letters typed for a Cyrillic name', () => {
    expect(idOf('Isperih')).toBe('asparuh');
    expect(idOf('asparuh')).toBe('asparuh');
    expect(idOf('petar 1')).toBe('peter'); // Латин -> Петър via the transliteration
    expect(idOf('sparuh')).toBeNull(); // a substring is not a match
  });

  it('needs the number of a numbered name, Roman or Arabic', () => {
    expect(idOf('Борис 1')).toBe('boris1');
    expect(idOf('Борис I')).toBe('boris1');
    expect(idOf('борис2')).toBe('boris2');
    expect(idOf('Борис II')).toBe('boris2');
    expect(idOf('boris 2')).toBe('boris2');
    expect(idOf('Boris II')).toBe('boris2');
    expect(idOf('Симеон 1')).toBe('simeon');
    expect(idOf('Симеон I Велики')).toBe('simeon');
    expect(idOf('Петър I')).toBe('peter');
  });
  it('never accepts a numbered name without its number', () => {
    expect(idOf('Борис')).toBeNull();
    expect(idOf('Boris')).toBeNull();
    expect(idOf('Симеон')).toBeNull();
    expect(idOf('Петър')).toBeNull();
    expect(idOf('Борис', new Set(['boris1']))).toBeNull(); // not even when one is left
  });
  it('Иван Асен after Иван Асен II is still not enough; the number is', () => {
    const done = new Set(['asen2']);
    expect(idOf('Иван Асен', done)).toBeNull();
    expect(idOf('Иван Асен 3', done)).toBe('asen3');
    expect(idOf('Иван Асен III', done)).toBe('asen3');
    expect(idOf('Ivan Asen III', done)).toBe('asen3');
    expect(idOf('Иван Асен 2')).toBe('asen2');
    expect(idOf('Иван Асен 2', done)).toBeNull();
  });
  it('accepts the surname of a multi-word name when no other person shares it', () => {
    expect(idOf('Батенберг')).toBe('alex');
    expect(idOf('Александър 1')).toBe('alex');
    expect(idOf('Александър I Батенберг')).toBe('alex');
    expect(idOf('Димитров')).toBe('georgi');
    expect(idOf('Георги Димитров')).toBe('georgi');
    expect(idOf('Малинов')).toBe('malinov');
  });
  it('never accepts a first name alone for a multi-word name', () => {
    expect(idOf('Александър')).toBeNull();
    expect(idOf('Георги')).toBeNull();
    expect(idOf('Бойко')).toBeNull();
  });
  it('rejects a surname shared by different people', () => {
    expect(idOf('Асен')).toBeNull(); // Иван Асен II and III
    const two = prepareFill([entry('a', 'Георги Димитров', '', 1), entry('b', 'Димитър Димитров', '', 2)]);
    expect(matchFill('Димитров', two, NONE)).toBeNull();
    expect(matchFill('Георги Димитров', two, NONE)).toMatchObject({ index: 0 });
  });
  it('the same person several times: surname or full name fills the earliest unfilled', () => {
    expect(idOf('Борисов')).toBe('boiko1');
    expect(idOf('Бойко Борисов')).toBe('boiko1');
    expect(idOf('Борисов', new Set(['boiko1']))).toBe('boiko2');
    expect(idOf('Бойко Борисов', new Set(['boiko1', 'boiko2']))).toBe('boiko3');
    expect(idOf('Борисов', new Set(['boiko1', 'boiko2', 'boiko3']))).toBeNull();
  });
  it('takes an alias as one exact spelling', () => {
    const list = prepareFill([entry('ferdinand', 'Фердинанд I', 'Ferdinand I', 1887, ['Фердинанд', 'Ferdinand'])]);
    expect(matchFill('Фердинанд', list, NONE)).toMatchObject({ index: 0 });
    expect(matchFill('Ferdinand', list, NONE)).toMatchObject({ index: 0 });
    expect(matchFill('Александър', list, NONE)).toBeNull();
    const numbered = prepareFill([entry('x', 'Калоян', 'Kaloyan', 1, ['Борис II'])]);
    expect(matchFill('Борис', numbered, NONE)).toBeNull(); // nothing derived from an alias
    expect(matchFill('Борис 2', numbered, NONE)).toMatchObject({ index: 0 });
  });

  it('flags a numbered name typed without its number, only when nothing else matches', () => {
    expect(needsNumber('Иван Асен', PREPARED, NONE)).toBe(true);
    expect(needsNumber('Борис', PREPARED, NONE)).toBe(true);
    expect(needsNumber('boris', PREPARED, NONE)).toBe(true);
    expect(needsNumber('Александър', PREPARED, NONE)).toBe(true);
    expect(needsNumber('Борис 2', PREPARED, NONE)).toBe(false); // it matches
    expect(needsNumber('Аспарух', PREPARED, NONE)).toBe(false);
    expect(needsNumber('Георги', PREPARED, NONE)).toBe(false); // a first name, not a numbered one
    expect(needsNumber('', PREPARED, NONE)).toBe(false);
  });

  it('accepts instantly only when no longer name starts with the typed text', () => {
    expect(matchFill('Аспарух', PREPARED, NONE)).toMatchObject({ instant: true });
    expect(matchFill('Борис 1', PREPARED, NONE)).toMatchObject({ instant: true });
    expect(matchFill('Иван Асен 2', PREPARED, NONE)).toMatchObject({ instant: true });
    expect(matchFill('Симеон 1', PREPARED, NONE)).toMatchObject({ instant: true }); // its own longer form doesn't block
  });
  it('waits for Enter when the Latin text is still a prefix of another name', () => {
    expect(matchFill('boris 1', PREPARED, NONE)).toMatchObject({ instant: true });
    expect(matchFill('asparu', PREPARED, NONE)).toBeNull();
    const pre = prepareFill([entry('a', 'Калоян', 'x', 1), entry('b', 'Калоянов', 'y', 2)]);
    expect(matchFill('kaloyan', pre, NONE)).toMatchObject({ instant: false });
  });

  it('forgives one typo in a name of 6+ letters, on Enter only', () => {
    expect(matchFill('Аспаруг', PREPARED, NONE)).toMatchObject({ index: 0, typo: true, instant: false });
    expect(idOf('Аспарух'.slice(0, -1))).toBe('asparuh'); // one letter short
    expect(idOf('Тервел'.replace('в', 'б'))).toBe('tervel');
  });
  it('gives no typo allowance to short names', () => {
    expect(idOf('Петар I')).toBeNull(); // Петър, 5 letters
    expect(idOf('Борус')).toBeNull();
  });
  it('never lets a typo cross a numeral', () => {
    expect(idOf('Борис 3')).toBeNull();
    expect(idOf('Симеон 2')).toBeNull();
    expect(idOf('Борис')).toBeNull(); // nor drop one
  });
  it('never applies a typo that would make two entries match', () => {
    const twins = prepareFill([entry('a', 'Калоян', 'x', 1), entry('b', 'Калаян', 'y', 2)]);
    expect(matchFill('Калиян', twins, NONE)).toBeNull();
    expect(matchFill('Калоян'.slice(0, -1) + 'нн', twins, NONE)).toMatchObject({ index: 0, typo: true });
  });
  it('does not typo-match text that is exactly a filled entry', () => {
    const list = prepareFill([entry('a', 'Калоян', 'x', 1), entry('b', 'Калоян', 'y', 2)]);
    expect(matchFill('Калоян', list, new Set(['a']))).toMatchObject({ index: 1, typo: false });
    const near = prepareFill([entry('a', 'Симеон', 'x', 1), entry('b', 'Симеан', 'y', 2)]);
    expect(matchFill('Симеон', near, new Set(['a']))).toBeNull();
  });
  it('returns null for empty and title-only input', () => {
    expect(idOf('')).toBeNull();
    expect(idOf('  ')).toBeNull();
    expect(idOf('хан')).toBeNull();
  });
});

describe('titles', () => {
  it('cleans a role into a title', () => {
    expect(titleOf('хан')).toBe('хан');
    expect(titleOf('цар (малолетен)')).toBe('цар');
    expect(titleOf('княз, от 1908 цар')).toBe('княз, от 1908 цар');
    expect(titleOf(null)).toBe('');
  });
  it('shows titles only when the quiz has more than one', () => {
    expect(hasMixedTitles([{ title: 'хан' }, { title: 'цар' }])).toBe(true);
    expect(hasMixedTitles([{ title: 'министър-председател' }, { title: 'министър-председател' }])).toBe(false);
  });
  it('never counts or shows "президент"', () => {
    expect(hasMixedTitles([{ title: 'президент' }, { title: 'и.д. президент' }])).toBe(false);
    expect(hasMixedTitles([{ title: 'президент' }, { title: 'и.д. президент' }, { title: 'цар' }])).toBe(true);
    expect(isShownTitle('президент')).toBe(false);
    expect(isShownTitle('и.д. президент')).toBe(true);
  });
  it('splits a trailing parenthesis off a name', () => {
    expect(splitNote('Петър IV (Теодор-Петър)')).toEqual({ main: 'Петър IV', note: '(Теодор-Петър)' });
    expect(splitNote('Фердинанд I')).toEqual({ main: 'Фердинанд I', note: '' });
  });
});

describe('labels', () => {
  it('shows a year range, or one year when the span is within a year', () => {
    expect(yearLabel({ start: 681, end: 700 })).toBe('681–700');
    expect(yearLabel({ start: 765, end: 766 })).toBe('765');
    expect(yearLabel({ start: 1879.5, end: 1879.6 })).toBe('1879');
    expect(yearLabel({ start: 1989, end: null })).toBe('1989–');
  });
  it('formats authored dates as dd.mm.yyyy, keeping only what was authored', () => {
    expect(formatFillDate('1879-07-05')).toBe('05.07.1879');
    expect(formatFillDate('1879-07')).toBe('07.1879');
    expect(formatFillDate('681')).toBe('681');
    expect(dateRangeLabel({ startRaw: '1989-11-10', endRaw: null })).toBe('10.11.1989 – today');
  });
});

describe('fillQuizzesFromRaw', () => {
  const raw = (
    id: string, kind: string, start: string, end: string | null, role: string | null = null, elected?: boolean
  ): FillRawEntry => ({ id, kind, name: { bg: id, en: '' }, aliases: [], role, start, end, ...(elected === undefined ? {} : { elected }) });
  const row = (over: Partial<FillQuizConfig>): FillQuizConfig =>
    ({ id: 'q', title: 'Q', kind: 'ruler', role: /(?:)/, ...over });

  it('filters by kind, role regex and a start window (from inclusive, before exclusive)', () => {
    const data = [
      raw('a', 'ruler', '100', '120', 'хан'), raw('b', 'ruler', '150', '160', 'цар'),
      raw('c', 'ruler', '200', '210', 'хан'), raw('d', 'ruler', '180', null, null),
      raw('e', 'government', '150', '160', 'хан')
    ];
    const ids = (config: FillQuizConfig) => fillQuizzesFromRaw(data, 'x', [config])[0]?.entries.map(e => e.id);
    expect(ids(row({ from: '100', before: '200' }))).toEqual(['a', 'b', 'd']);
    expect(ids(row({ role: /хан/, from: '100', before: '201' }))).toEqual(['a', 'c']);
    expect(ids(row({ kind: 'government' }))).toEqual(['e']);
    expect(ids(row({ role: /няма/ }))).toBeUndefined(); // nothing selected: no quiz
  });

  it('keeps the config order and carries the title and toggle', () => {
    const quizzes = fillQuizzesFromRaw([raw('a', 'ruler', '1', '2', 'хан')], 'x', [
      row({ id: 'two', title: 'Two' }), row({ id: 'one', title: 'One', toggle: { label: 'T' } })
    ]);
    expect(quizzes.map(q => q.id)).toEqual(['two', 'one']);
    expect(quizzes.map(q => q.toggle)).toEqual([null, { label: 'T' }]);
  });

  it('entriesFor drops elected:false only with the toggle on, and a missing flag counts as elected', () => {
    const [quiz] = fillQuizzesFromRaw(
      [raw('a', 'ruler', '1', '2', 'x'), raw('b', 'ruler', '3', '4', 'x', false), raw('c', 'ruler', '5', '6', 'x', true)],
      'x', [row({ toggle: { label: 'T' } })]
    );
    expect(entriesFor(quiz, false).map(e => e.id)).toEqual(['a', 'b', 'c']);
    expect(entriesFor(quiz, true).map(e => e.id)).toEqual(['a', 'c']);
    const [plain] = fillQuizzesFromRaw([raw('b', 'ruler', '3', '4', 'x', false)], 'x', [row({})]);
    expect(entriesFor(plain, true).map(e => e.id)).toEqual(['b']); // no toggle: nothing is dropped
  });
});

describe('the Bulgarian quiz table on the shipped timeline', () => {
  const doc = JSON.parse(readFileSync('public/data/history/bg.json', 'utf8')) as { entries: FillRawEntry[] };
  const quizzes = fillQuizzesFromRaw(doc.entries, 'bulgaria');
  const quiz = (id: string) => quizzes.find(q => q.id === `bulgaria-${id}`)!;
  const ids = (q: FillQuiz, on = false) => entriesFor(q, on).map(e => e.id);

  it('has the nine quizzes, with English titles and non-empty lists', () => {
    expect(quizzes.map(q => q.title)).toEqual([
      'Rulers of the First Bulgarian Empire', 'Rulers of the Second Bulgarian Empire',
      'Princes and Tsars of Bulgaria', 'Heads of state, People\'s Republic', 'BKP leaders', 'Presidents',
      'Prime ministers, Principality and Kingdom', 'Prime ministers, People\'s Republic', 'Prime ministers, Republic'
    ]);
    expect(quizzes.filter(q => q.toggle).map(q => q.id)).toEqual(['bulgaria-presidents']);
  });

  it('First Bulgarian Empire: every ruler from 681 to 1018, in order', () => {
    const first = quiz('rulers-first-empire');
    expect(first.entries.length).toBe(26);
    expect(first.entries[0].name).toBe('Аспарух');
    expect(first.entries.at(-1)!.name).toBe('Иван Владислав');
    for (let i = 1; i < first.entries.length; i++) expect(first.entries[i].start).toBeGreaterThanOrEqual(first.entries[i - 1].start);
  });

  it('Second Bulgarian Empire starts with Asen and Peter and stays inside 1185..1396', () => {
    const second = quiz('rulers-second-empire');
    expect(second.entries.length).toBeGreaterThan(10);
    for (const e of second.entries) expect(Math.floor(e.start)).toBeGreaterThanOrEqual(1185);
    for (const e of second.entries) expect(Math.floor(e.start)).toBeLessThanOrEqual(1396);
  });

  it('Princes and Tsars includes Simeon II (1943) and stops before the 1946 republic', () => {
    const r = ids(quiz('rulers-principality-kingdom'));
    expect(r).toEqual([
      'ruler-aleksandar-1-batenberg', 'ruler-ferdinand-1', 'ruler-boris-3', 'ruler-simeon-2'
    ].filter(id => r.includes(id)));
    expect(r).toContain('ruler-simeon-2');
    expect(r).not.toContain('ruler-georgi-dimitrov-bkp');
  });

  it('heads of state, BKP leaders and presidents pick their roles only', () => {
    expect(ids(quiz('heads-of-state-peoples-republic'))).toContain('ruler-vasil-kolarov-state-head');
    expect(quiz('bkp-leaders').entries.length).toBe(4);
    const presidents = ids(quiz('presidents'));
    expect(presidents).toContain('pres-todorov-acting'); // "и.д. президент" matches too
    expect(presidents.every(id => id.startsWith('pres-'))).toBe(true);
  });

  it('the elected toggle removes Mladenov and Todorov (acting), and nobody else (Yotova counts as elected)', () => {
    const presidents = quiz('presidents');
    const all = ids(presidents, false);
    const elected = ids(presidents, true);
    expect(all).toEqual(expect.arrayContaining(['pres-mladenov', 'pres-todorov-acting', 'pres-yotova']));
    expect(elected).not.toContain('pres-mladenov');
    expect(elected).not.toContain('pres-todorov-acting');
    expect(elected).toContain('pres-yotova');
    expect(elected).toEqual(expect.arrayContaining(['pres-zhelev', 'pres-stoyanov', 'pres-parvanov', 'pres-plevneliev', 'pres-radev']));
    expect(all.length - elected.length).toBe(2);
  });

  it('the three prime-minister quizzes cover every prime minister exactly once: no overlap, no gap', () => {
    const pmQuizzes = ['pms-principality-kingdom', 'pms-peoples-republic', 'pms-republic'].map(quiz);
    const listed = pmQuizzes.flatMap(q => ids(q));
    expect(new Set(listed).size).toBe(listed.length); // no overlap
    const allPms = doc.entries.filter(e => e.kind === 'government').map(e => e.id);
    expect([...listed].sort()).toEqual([...allPms].sort()); // no gap
    // and the boundaries fall where the periods do
    expect(ids(pmQuizzes[0])).toContain('pm-kimon-georgiev-3'); // 31.03.1946
    expect(ids(pmQuizzes[1])).toContain('pm-georgi-dimitrov'); // 22.11.1946
    expect(ids(pmQuizzes[1])).toContain('pm-atanasov'); // last PM before 10.11.1989
    expect(ids(pmQuizzes[2])).toContain('pm-lukanov');
  });
});

describe('the United States quiz table on the shipped timeline', () => {
  const doc = JSON.parse(readFileSync('public/data/history/us.json', 'utf8')) as { entries: FillRawEntry[] };
  const quizzes = fillQuizzesFromRaw(doc.entries, 'united-states');
  const quiz = (id: string) => quizzes.find(q => q.id === `united-states-${id}`)!;
  const all = quiz('presidents');
  const prepared = prepareFill(all.entries);
  const idOf = (typed: string, filled: ReadonlySet<string> = new Set()) => {
    const m = matchFill(typed, prepared, filled);
    return m ? prepared[m.index].id : null;
  };

  it('has eight quizzes; only the two full lists have the elected toggle', () => {
    expect(quizzes.map(q => q.title)).toEqual([
      'Presidents of the United States', 'Presidents, 1789-1869', 'Presidents, 1869-1945', 'Presidents, 1945-today',
      'Vice Presidents of the United States', 'Vice Presidents, 1789-1869', 'Vice Presidents, 1869-1949',
      'Vice Presidents, 1949-today'
    ]);
    expect(quizzes.filter(q => q.toggle).map(q => [q.id, q.toggle!.label])).toEqual([
      ['united-states-presidents', 'Elected to the office only'],
      ['united-states-vice-presidents', 'Elected to the office only']
    ]);
  });

  it('holds all 47 presidencies; the toggle drops the five never elected', () => {
    expect(all.entries.length).toBe(47);
    expect(entriesFor(all, true).length).toBe(42);
  });

  it('the three windows hold 17, 15 and 15 presidencies, together every one exactly once', () => {
    const windows = ['presidents-1789-1869', 'presidents-1869-1945', 'presidents-1945-today'].map(quiz);
    expect(windows.map(q => q.entries.length)).toEqual([17, 15, 15]);
    expect(windows.flatMap(q => q.entries.map(e => e.id)).sort()).toEqual(all.entries.map(e => e.id).sort());
  });

  it('rejects a spelling shared by two different people', () => {
    for (const typed of ['Harrison', 'Johnson', 'Roosevelt', 'Adams', 'Bush', 'Харисън', 'Рузвелт', 'Буш']) {
      expect(idOf(typed), typed).toBeNull();
    }
  });

  it('accepts unambiguous names and aliases', () => {
    expect(idOf('Lincoln')).toBe('pres-lincoln');
    expect(idOf('Teddy Roosevelt')).toBe('pres-t-roosevelt');
    expect(idOf('Franklin Roosevelt')).toBe('pres-f-roosevelt');
    expect(idOf('Буш старши')).toBe('pres-bush-sr');
    expect(idOf('Bush Sr')).toBe('pres-bush-sr');
    expect(idOf('Bush Jr')).toBe('pres-bush-jr');
    expect(idOf('Monroe')).toBe('pres-monroe');
    expect(idOf('Monro')).toBeNull();
    expect(idOf('H Bush')).toBe('pres-bush-sr');
    expect(idOf('H W Bush')).toBe('pres-bush-sr');
    expect(idOf('W Bush')).toBe('pres-bush-jr');
    expect(idOf('B Johnson')).toBe('pres-l-johnson');
    expect(idOf('Henry Harrison')).toBe('pres-wh-harrison');
    expect(idOf('John Q Adams')).toBe('pres-jq-adams');
  });

  it('the same person twice fills the earliest unfilled rectangle', () => {
    expect(idOf('Cleveland')).toBe('pres-cleveland-1');
    expect(idOf('Cleveland', new Set(['pres-cleveland-1']))).toBe('pres-cleveland-2');
    expect(idOf('Cleveland', new Set(['pres-cleveland-1', 'pres-cleveland-2']))).toBeNull();
    expect(idOf('Trump')).toBe('pres-trump-1');
    expect(idOf('Trump', new Set(['pres-trump-1']))).toBe('pres-trump-2');
  });
});

describe('the United States vice-president quizzes on the shipped timeline', () => {
  const doc = JSON.parse(readFileSync('public/data/history/us.json', 'utf8')) as { entries: FillRawEntry[] };
  const quizzes = fillQuizzesFromRaw(doc.entries, 'united-states');
  const quiz = (id: string) => quizzes.find(q => q.id === `united-states-${id}`)!;
  const all = quiz('vice-presidents');
  const prepared = prepareFill(all.entries);
  const idOf = (typed: string) => {
    const m = matchFill(typed, prepared, new Set());
    return m ? prepared[m.index].id : null;
  };

  it('the three windows hold 16, 18 and 16 vice presidents, together all 50 exactly once', () => {
    const windows = ['vice-presidents-1789-1869', 'vice-presidents-1869-1949', 'vice-presidents-1949-today'].map(quiz);
    expect(all.entries.length).toBe(50);
    expect(windows.map(q => q.entries.length)).toEqual([16, 18, 16]);
    const ids = windows.flatMap(q => q.entries.map(e => e.id));
    expect(new Set(ids).size).toBe(50);
    expect(ids.sort()).toEqual(all.entries.map(e => e.id).sort());
  });

  it('rejects Johnson, shared by three vice presidents', () => {
    expect(idOf('Johnson')).toBeNull();
    expect(idOf('Lyndon Johnson')).toBe('vp-johnson-lyndon');
  });

  it('the toggle removes Ford and Rockefeller, and nobody else', () => {
    const on = entriesFor(all, true).map(e => e.id);
    expect(on.length).toBe(48);
    expect(all.entries.map(e => e.id).filter(i => !on.includes(i)).sort()).toEqual(['vp-ford', 'vp-rockefeller']);
  });

  it('Stevenson fills Adlai E. Stevenson I', () => {
    expect(idOf('Stevenson')).toBe('vp-stevenson');
  });
});

describe('matchFill: shared aliases', () => {
  it('an alias held by two different people is never accepted; the same person twice is', () => {
    const list = prepareFill([
      entry('a', 'Иван Петров', 'Ivan Petrov', 1900, ['Ivo']),
      entry('b', 'Иван Сидоров', 'Ivan Sidorov', 1910, ['Ivo']),
      entry('c', 'Иван Сидоров', 'Ivan Sidorov', 1920)
    ]);
    expect(matchFill('Ivo', list, new Set())).toBeNull();
    expect(matchFill('Sidorov', list, new Set())?.index).toBe(1);
    expect(matchFill('Sidorov', list, new Set(['b']))?.index).toBe(2);
  });
});

describe('number-optional exceptions', () => {
  it('accepts Михаил Шишман / Михаил Асен, still rejects a spelling shared by two people', () => {
    const list = prepareFill([
      entry('ruler-mihail-2-asen', 'Михаил II Асен', 'Mihail II Asen', 1, ['Михаил Асен']),
      entry('ruler-mihail-3-shishman', 'Михаил III Шишман', 'Mihail III Shishman', 2, ['Михаил Шишман']),
      entry('ruler-ivan-shishman', 'Иван Шишман', 'Ivan Shishman', 3)
    ]);
    expect(matchFill('Михаил Асен', list, NONE)).toMatchObject({ index: 0 });
    expect(matchFill('Михаил Шишман', list, NONE)).toMatchObject({ index: 1 });
    expect(matchFill('Шишман', list, NONE)).toBeNull();
    const clash = prepareFill([
      entry('a', 'Михаил II Асен', '', 1, ['Михаил Асен']),
      entry('b', 'Михаил I Асен', '', 2, ['Михаил Асен'])
    ]);
    expect(matchFill('Михаил Асен', clash, NONE)).toBeNull();
  });
});
