/**
 * The "fill the list" History quiz (app/lib/history/fill-quiz.ts): matching typed names to
 * entries, and which quizzes a timeline yields. Pure logic, no browser.
 *
 *   npm run test:unit
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  dateRangeLabel, fillQuizzesFromRaw, formatFillDate, matchFill, normaliseFill, prepareFill, yearLabel,
  type FillEntry, type FillRawEntry
} from '~/lib/history/fill-quiz';

function entry(id: string, nameBg: string, nameEn: string, start: number, aliases: string[] = []): FillEntry {
  return { id, kind: 'ruler', nameBg, nameEn, aliases, start, end: start + 10, startRaw: String(start), endRaw: String(start + 10) };
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
  const raw = (id: string, kind: string, start: string, end: string | null, en = id): FillRawEntry =>
    ({ id, kind, name: { bg: id, en }, aliases: [], start, end });

  it('makes a quiz for each period with 3+ entries of a kind, including only entries inside it', () => {
    const quizzes = fillQuizzesFromRaw([
      raw('period-one', 'period', '100', '200', 'One'),
      raw('period-two', 'period', '200', null, 'Two'),
      raw('r1', 'ruler', '100', '120'), raw('r2', 'ruler', '120', '150'), raw('r3', 'ruler', '150', '200'),
      raw('r4', 'ruler', '190', '210'), // straddles the boundary: in neither
      raw('r5', 'ruler', '200', '210'), raw('r6', 'ruler', '210', '220'), // two in "Two": too few
      raw('g1', 'government', '1', '2')
    ], 'x');
    expect(quizzes.map(q => q.id)).toEqual(['x-rulers-one']);
    expect(quizzes[0].title).toBe('Rulers: One');
    expect(quizzes[0].entries.map(e => e.id)).toEqual(['r1', 'r2', 'r3']);
  });
  it('yields governments too, and lets an open end fit an open-ended period', () => {
    const quizzes = fillQuizzesFromRaw([
      raw('period-now', 'period', '1989', null, 'Now'),
      raw('g1', 'government', '1990-01-01', '1991-01-01'), raw('g2', 'government', '1991-01-01', '1992-01-01'),
      raw('g3', 'government', '1992-01-01', null)
    ], 'x');
    expect(quizzes.map(q => q.title)).toEqual(['Governments: Now']);
    expect(quizzes[0].entries).toHaveLength(3);
  });

  it('builds Rulers of the First Bulgarian Empire from the shipped data, none skipped', () => {
    const doc = JSON.parse(readFileSync('public/data/history/bg.json', 'utf8')) as { entries: FillRawEntry[] };
    const quizzes = fillQuizzesFromRaw(doc.entries, 'bulgaria');
    const first = quizzes.find(q => q.id === 'bulgaria-rulers-first-empire');
    expect(first?.title).toBe('Rulers: First Bulgarian Empire');
    expect(first!.entries.length).toBe(26); // every ruler inside 681-1018, none skipped
    expect(first!.entries[0].nameBg).toBe('Аспарух');
    expect(first!.entries.at(-1)!.nameBg).toBe('Иван Владислав');
    for (let i = 1; i < first!.entries.length; i++) expect(first!.entries[i].start).toBeGreaterThanOrEqual(first!.entries[i - 1].start);
  });
});
