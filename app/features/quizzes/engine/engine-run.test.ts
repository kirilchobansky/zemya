/**
 * The quiz engine hook (app/features/quizzes/engine/engine.ts): Give up and the review pass's painting. There is no
 * DOM in the unit environment, so `react` is replaced by a ~40-line hook runtime (state, refs,
 * memoised callbacks, effects run after each render) and `window`/`document` by bare event
 * targets — enough to drive the real engine code, not a copy of it.
 *
 *   npm run test:unit
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', async () => (await import('./engine-test-runtime')).h.react);
vi.mock('~/features/progress/ProgressProvider', () => ({ useProgress: () => ({ review: h.review }) }));
vi.mock('~/features/progress/quiz-runs', () => ({
  bestQuizTime: () => Promise.resolve(null),
  saveQuizRun: vi.fn(() => Promise.resolve(7)),
  addReviewTime: vi.fn(),
}));

import { addReviewTime, saveQuizRun } from '~/features/progress';
import { REVEAL_FILL_MS, useQuizEngine } from './engine';
import { abandon, CAPITALS, COUNTRIES, country, ctx, h, keyEvent, render, resetHarness, under } from './engine-test-runtime';
import { saveFinishedRun, savedFinishedRun } from './finished-runs';

under.hook = useQuizEngine;

const enterInInput = () => ctx.engine.onInputKeyDown(keyEvent('Enter') as never);
const type = (value: string) => ctx.engine.onInputChange({ target: { value } } as never);
const press = (e: ReturnType<typeof keyEvent>) => (ctx.listeners.keydown ?? []).slice().forEach(l => l(e));
/** The engine as of the latest render. */
const eng = () => ctx.engine;

beforeEach(() => {
  resetHarness();
  vi.mocked(saveQuizRun).mockClear();
  render(CAPITALS);
  eng().start();
});

describe('Give up', () => {
  it('ends the run with the unanswered countries missed, saving and grading nothing', () => {
    const first = eng().target!;
    type(first.capital!); // one right
    eng().giveUp();
    expect(eng().phase).toBe('done');
    expect(eng().result?.gaveUp).toBe(true);
    expect(eng().result?.perfect).toBe(false);
    expect(eng().result?.revealed.map(c => c.iso3).sort()).toEqual(COUNTRIES.filter(c => c !== first).map(c => c.iso3).sort());
    expect(eng().settled.get(first.iso3)).toBe('correct');
    for (const c of COUNTRIES.filter(c => c !== first)) expect(eng().settled.get(c.iso3)).toBe('revealed');
    expect(saveQuizRun).not.toHaveBeenCalled();
    expect(h.review).toHaveBeenCalledTimes(1); // only the one real answer
  });
});

describe('Review pass painting', () => {
  it('keeps the countries the run had right painted, leaving only the ones under review unmarked', () => {
    const [missed] = COUNTRIES;
    for (let n = 0; n < COUNTRIES.length; n++) {
      if (eng().target!.iso3 === missed.iso3) {
        eng().reveal();
        enterInInput();
        vi.advanceTimersByTime(REVEAL_FILL_MS);
      } else type(eng().target!.capital!);
    }
    eng().reviewMistakes();
    expect(eng().settled.has(missed.iso3)).toBe(false);
    for (const c of COUNTRIES.filter(c => c !== missed)) expect(eng().settled.get(c.iso3)).toBe('correct');
    expect(eng().answeredCount).toBe(0);
  });

  it('paints a restored finished run the way it ended', () => {
    eng().giveUp();
    const run = eng().snapshot()!;
    h.rt.slots = [];
    h.rt.setters = {};
    render(CAPITALS);
    eng().restoreResult(run);
    expect(eng().phase).toBe('done');
    expect(eng().result?.gaveUp).toBe(true);
    for (const c of COUNTRIES) expect(eng().settled.get(c.iso3)).toBe('revealed');
  });
});
