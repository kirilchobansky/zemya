/**
 * The "fill the list" History quiz (app/lib/history/fill-quiz.ts): matching typed names to
 * entries, and which quizzes a timeline yields. Pure logic, no browser.
 *
 *   npm run test:unit
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  dateRangeLabel, entriesFor, fillQuizzesFromRaw, formatFillDate, matchFill, normaliseFill, prepareFill, yearLabel,
  type FillEntry, type FillQuiz, type FillRawEntry
} from '~/lib/history/fill-quiz';
import type { FillQuizConfig } from '~/lib/history/fill-quiz-config';

function entry(id: string, nameBg: string, nameEn: string, start: number, aliases: string[] = []): FillEntry {
  return { id, kind: 'ruler', nameBg, nameEn, aliases, start, end: start + 10, startRaw: String(start), endRaw: String(start + 10), elected: true };
}

const LIST = [
  entry('asparuh', 'Аспарух', 'Asparuh', 681, ['Isperih']),
  entry('tervel', 'Тервел', 'Tervel', 700),
  entry('boris1', 'Борис I', 'Boris I', 852),
  entry('simeon', 'Симеон I Велики', 'Simeon I the Great', 893),
  entry('boris2', 'Борис II', 'Boris II', 969),
  entry('peter', 'Петър I', 'Peter I', 927)
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
  it('accepts the last name alone, without the title', () => {
    expect(idOf('Аспарух')).toBe('asparuh');
    expect(idOf('хан Аспарух')).toBe('asparuh');
  });
  it('accepts the English name and aliases', () => {
    expect(idOf('tervel')).toBe('tervel');
    expect(idOf('Isperih')).toBe('asparuh');
  });
  it('accepts Latin letters typed for a Cyrillic name, against the whole name', () => {
    expect(idOf('asparuh')).toBe('asparuh');
    expect(idOf('Tervel')).toBe('tervel');
    expect(idOf('simeon')).toBe('simeon');
    expect(idOf('petar')).toBe('peter'); // Latin -> Петър via the transliteration, not the English name
    expect(idOf('sparuh')).toBeNull(); // a substring is not a match
  });
  it('treats Roman and Arabic numerals as the same', () => {
    expect(idOf('Борис 1')).toBe('boris1');
    expect(idOf('Борис I')).toBe('boris1');
    expect(idOf('борис2')).toBe('boris2');
    expect(idOf('Борис II')).toBe('boris2');
    expect(idOf('boris 2')).toBe('boris2');
  });
  it('accepts a name cut at its numeral', () => {
    expect(idOf('Симеон')).toBe('simeon');
    expect(idOf('Симеон 1')).toBe('simeon');
    expect(idOf('Симеон I Велики')).toBe('simeon');
  });

  it('fills the earliest entry when the name is ambiguous (Борис)', () => {
    expect(idOf('Борис')).toBe('boris1');
    expect(idOf('Boris')).toBe('boris1');
  });
  it('matches only the numbered entry when the numeral is typed', () => {
    expect(idOf('Борис 2')).toBe('boris2');
  });
  it('ignores an already filled entry', () => {
    expect(idOf('Борис', new Set(['boris1']))).toBe('boris2');
    expect(idOf('Борис 1', new Set(['boris1']))).toBeNull();
  });

  it('accepts instantly only when no longer name starts with the typed text', () => {
    expect(matchFill('Аспарух', PREPARED, NONE)).toMatchObject({ instant: true });
    expect(matchFill('Борис', PREPARED, NONE)).toMatchObject({ instant: false }); // Борис 2 exists
    expect(matchFill('Борис 1', PREPARED, NONE)).toMatchObject({ instant: true });
    expect(matchFill('Борис', PREPARED, new Set(['boris1']))).toMatchObject({ instant: true });
    expect(matchFill('Симеон', PREPARED, NONE)).toMatchObject({ instant: true }); // its own "Симеон 1" doesn't block
  });
  it('waits for Enter when the Latin text is still a prefix of another name', () => {
    expect(matchFill('boris', PREPARED, NONE)).toMatchObject({ instant: false });
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
  });
  it('never applies a typo that would make two entries match', () => {
    const twins = prepareFill([entry('a', 'Калоян', 'x', 1), entry('b', 'Калаян', 'y', 2)]);
    // one edit from both names -> ambiguous -> rejected
    expect(matchFill('Калиян', twins, NONE)).toBeNull();
    // one edit from only "Калоян" -> accepted
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
    expect(first.entries[0].nameBg).toBe('Аспарух');
    expect(first.entries.at(-1)!.nameBg).toBe('Иван Владислав');
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

  it('the elected toggle removes Mladenov, Todorov (acting) and Yotova, and nobody else', () => {
    const presidents = quiz('presidents');
    const all = ids(presidents, false);
    const elected = ids(presidents, true);
    expect(all).toEqual(expect.arrayContaining(['pres-mladenov', 'pres-todorov-acting', 'pres-yotova']));
    expect(elected).not.toContain('pres-mladenov');
    expect(elected).not.toContain('pres-todorov-acting');
    expect(elected).not.toContain('pres-yotova');
    expect(elected).toEqual(expect.arrayContaining(['pres-zhelev', 'pres-stoyanov', 'pres-parvanov', 'pres-plevneliev', 'pres-radev']));
    expect(all.length - elected.length).toBe(3);
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
