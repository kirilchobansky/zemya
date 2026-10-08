/**
 * The quiz engine hook (app/features/quizzes/engine/engine.ts): Enter after a reveal, and Restart. There is no
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

describe('Enter after a reveal', () => {
  it('fills the answer, then advances with outcome "revealed"', () => {
    const first = eng().target!;
    eng().reveal();
    enterInInput();
    expect(eng().input).toBe(first.capital);
    expect(eng().answeredCount).toBe(0); // not yet: the answer shows for a beat
    vi.advanceTimersByTime(REVEAL_FILL_MS);
    expect(eng().answered.get(first.iso3)).toBe('revealed');
    expect(eng().target).not.toBe(first);
    expect(eng().input).toBe('');
    expect(h.review).toHaveBeenCalledWith(expect.stringContaining(first.iso3), 'again');
  });

  it('also works with focus elsewhere (document-level Enter)', () => {
    const first = eng().target!;
    eng().reveal();
    press(keyEvent('Enter', { target: { closest: () => null } }));
    vi.advanceTimersByTime(REVEAL_FILL_MS);
    expect(eng().answered.get(first.iso3)).toBe('revealed');
  });

  it('does nothing when the target is not revealed', () => {
    const first = eng().target!;
    enterInInput();
    press(keyEvent('Enter', { target: { closest: () => null } }));
    vi.advanceTimersByTime(1000);
    expect(eng().target).toBe(first);
    expect(eng().input).toBe('');
    expect(eng().answeredCount).toBe(0);
  });

  it('still accepts the revealed answer typed by hand', () => {
    const first = eng().target!;
    eng().reveal();
    type(first.capital!);
    expect(eng().answered.get(first.iso3)).toBe('revealed');
    expect(eng().target).not.toBe(first);
  });

  it('finishes the run when the last target is filled in', () => {
    for (let n = 0; n < COUNTRIES.length; n++) {
      eng().reveal();
      enterInInput();
      vi.advanceTimersByTime(REVEAL_FILL_MS);
    }
    expect(eng().phase).toBe('done');
    expect(eng().result?.revealed).toHaveLength(COUNTRIES.length);
    expect(saveQuizRun).toHaveBeenCalledOnce();
  });
});

describe('Restart', () => {
  it('starts a clean run: nothing saved, nothing graded, progress cleared', () => {
    type(eng().target!.capital!); // one honest answer first
    eng().reveal();
    h.review.mockClear();
    eng().restart();
    expect(eng().phase).toBe('running');
    expect(eng().answeredCount).toBe(0);
    expect(eng().remainingCount).toBe(COUNTRIES.length);
    expect(eng().revealedSet.size).toBe(0);
    expect(eng().input).toBe('');
    expect(h.review).not.toHaveBeenCalled();
    expect(saveQuizRun).not.toHaveBeenCalled();
    expect(abandon).not.toHaveBeenCalled();
  });

  it('runs on a newly drawn set when given one, and finishes against it', () => {
    const fresh = [country('DDD', 'Dland', 'Delta City'), country('EEE', 'Eland', 'Eps City')];
    eng().restart(fresh);
    expect(eng().totalCount).toBe(2);
    expect(eng().remainingCount).toBe(2);
    expect(fresh).toContain(eng().target);
    for (let n = 0; n < 2; n++) type(eng().target!.capital!);
    expect(eng().phase).toBe('done');
    expect(eng().result?.firstTryCount).toBe(2);
  });

  it('drops a pending Enter fill', () => {
    eng().reveal();
    enterInInput();
    eng().restart();
    vi.advanceTimersByTime(REVEAL_FILL_MS * 2);
    expect(eng().answeredCount).toBe(0);
  });
});

describe('Review mistakes', () => {
  it('replays only the revealed countries and archives the time as the next try', async () => {
    const [missed] = COUNTRIES;
    for (let n = 0; n < COUNTRIES.length; n++) {
      if (eng().target!.iso3 === missed.iso3) {
        eng().reveal();
        enterInInput();
        vi.advanceTimersByTime(REVEAL_FILL_MS);
      } else type(eng().target!.capital!);
    }
    expect(eng().phase).toBe('done');
    expect(saveQuizRun).toHaveBeenCalledOnce();

    eng().reviewMistakes();
    expect(eng().reviewing).toBe(true);
    expect(eng().totalCount).toBe(1);
    expect(eng().target).toBe(missed);
    type(missed.capital!);
    expect(eng().phase).toBe('done');
    expect(saveQuizRun).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(addReviewTime).toHaveBeenCalledWith(7, expect.any(Number), 0);
  });
});

describe('Finished run kept across a dossier visit', () => {
  it('restores the same results without saving anything again, and Review still replays the misses', async () => {
    const [missed] = COUNTRIES;
    for (let n = 0; n < COUNTRIES.length; n++) {
      if (eng().target!.iso3 === missed.iso3) {
        eng().reveal();
        enterInInput();
        vi.advanceTimersByTime(REVEAL_FILL_MS);
      } else type(eng().target!.capital!);
    }
    const before = eng().result;
    const run = eng().snapshot()!;
    saveFinishedRun('/run', 't1', run);
    expect(savedFinishedRun('/run', 'other')).toBeNull();
    expect(savedFinishedRun('/run', null)).toBeNull();

    // leave and come back: a fresh engine (the route remounted)
    h.rt.slots = [];
    h.rt.setters = {};
    render(CAPITALS);
    expect(eng().phase).toBe('idle');
    vi.mocked(saveQuizRun).mockClear();
    h.review.mockClear();
    vi.mocked(addReviewTime).mockClear();
    eng().restoreResult(savedFinishedRun('/run', 't1')!);

    expect(eng().phase).toBe('done');
    expect(eng().result).toEqual(before);
    expect(eng().totalCount).toBe(COUNTRIES.length);
    expect(saveQuizRun).not.toHaveBeenCalled();
    expect(addReviewTime).not.toHaveBeenCalled();
    expect(h.review).not.toHaveBeenCalled();

    eng().reviewMistakes();
    expect(eng().totalCount).toBe(1);
    expect(eng().target).toBe(missed);
    type(missed.capital!);
    expect(eng().phase).toBe('done');
    expect(saveQuizRun).not.toHaveBeenCalled(); // a review pass appends to the restored row, never a new one
    await Promise.resolve();
    expect(addReviewTime).toHaveBeenCalledWith(7, expect.any(Number), 0);
  });
});
