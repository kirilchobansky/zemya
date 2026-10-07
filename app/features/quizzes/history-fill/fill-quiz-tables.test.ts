/**
 * The "fill the list" History quiz tables (app/features/quizzes/history-fill/fill-quiz.ts, fill-quiz-config.ts):
 * which quizzes a timeline yields, checked against the shipped Bulgarian and United States timelines.
 *
 *   npm run test:unit
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { entriesFor, fillQuizzesFromRaw, matchFill, prepareFill, type FillQuiz, type FillRawEntry } from './fill-quiz';
import type { FillQuizConfig } from './fill-quiz-config';

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
