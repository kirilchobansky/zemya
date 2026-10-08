/**
 * The "fill the list" History quiz (app/features/quizzes/history-fill/fill-quiz.ts): matching typed names to
 * entries, titles, labels, shared aliases and the number-optional exceptions. Pure logic, no browser.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from 'vitest';
import { dateRangeLabel, formatFillDate, hasMixedTitles, isShownTitle, matchFill, splitNote, needsNumber, normaliseFill, prepareFill, titleOf, yearLabel, type FillEntry } from './fill-quiz';

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

describe('fullNameOnly', () => {
  const list = prepareFill([
    { ...entry('g1', 'Георги I Тертер', '', 1280), fullNameOnly: true },
    { ...entry('g2', 'Георги II Тертер', '', 1321), fullNameOnly: true }
  ]);
  it('accepts the whole name, not the cut at the numeral', () => {
    expect(matchFill('Георги I Тертер', list, new Set())).toMatchObject({ index: 0 });
    expect(matchFill('Георги 1', list, new Set())).toBeNull();
  });
});
