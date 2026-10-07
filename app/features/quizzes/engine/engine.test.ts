/**
 * The quiz engine hook (app/features/quizzes/engine/engine.ts): Enter after a reveal, and Restart. There is no
 * DOM in the unit environment, so `react` is replaced by a ~40-line hook runtime (state, refs,
 * memoised callbacks, effects run after each render) and `window`/`document` by bare event
 * targets — enough to drive the real engine code, not a copy of it.
 *
 *   npm run test:unit
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const rt = {
    slots: [] as unknown[],
    i: 0,
    effects: [] as { fn: () => void | (() => void); deps?: unknown[] }[],
    rerender: () => {},
  };
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  return {
    rt,
    review: vi.fn(),
    react: {
      useState<T>(init: T | (() => T)) {
        const k = rt.i++;
        if (!(k in rt.slots)) rt.slots[k] = typeof init === 'function' ? (init as () => T)() : init;
        const set = (v: T | ((p: T) => T)) => {
          const next = typeof v === 'function' ? (v as (p: T) => T)(rt.slots[k] as T) : v;
          if (!Object.is(next, rt.slots[k])) { rt.slots[k] = next; rt.rerender(); }
        };
        return [rt.slots[k] as T, set] as const;
      },
      useRef<T>(init: T) {
        const k = rt.i++;
        if (!(k in rt.slots)) rt.slots[k] = { current: init };
        return rt.slots[k] as { current: T };
      },
      useCallback<T>(fn: T, deps: unknown[]) {
        const k = rt.i++;
        const prev = rt.slots[k] as { fn: T; deps: unknown[] } | undefined;
        if (prev && same(prev.deps, deps)) return prev.fn;
        rt.slots[k] = { fn, deps };
        return fn;
      },
      useEffect(fn: () => void | (() => void), deps?: unknown[]) {
        const k = rt.i++;
        const prev = rt.slots[k] as { deps?: unknown[]; cleanup?: void | (() => void) } | undefined;
        if (prev && same(prev.deps, deps)) return;
        rt.effects.push({ fn, deps });
        rt.slots[k] = { deps, cleanup: prev?.cleanup, pending: fn, k };
      },
    },
  };
});

vi.mock('react', () => h.react);
vi.mock('~/features/progress/ProgressProvider', () => ({ useProgress: () => ({ review: h.review }) }));
vi.mock('~/features/progress/quiz-runs', () => ({
  bestQuizTime: () => Promise.resolve(null),
  saveQuizRun: vi.fn(() => Promise.resolve(7)),
  addReviewTime: vi.fn(),
}));

import { addReviewTime, saveQuizRun } from '~/features/progress';
import { REVEAL_FILL_MS, useQuizEngine, type QuizEngine } from './engine';
import type { CountryRecord } from '~/engines/map/types';

const country = (iso3: string, name: string, capital: string): CountryRecord =>
  ({
    id: iso3, iso3, iso2: iso3.slice(0, 2), slug: name.toLowerCase(), name, aliases: [name], capital,
    capitalAliases: [capital], languages: ['Alpha', 'Beta'], religion: 'None', currencyName: null, currencyCode: null,
  }) as unknown as CountryRecord;

const COUNTRIES = [country('AAA', 'Aland', 'Alpha City'), country('BBB', 'Bland', 'Beta City'), country('CCC', 'Cland', 'Gamma City')];

type Def = Parameters<typeof useQuizEngine>[0];
let engine: QuizEngine;
let listeners: Record<string, ((e: unknown) => void)[]>;

/** Renders the hook, then runs the effects its render queued (cleanups first, like React). */
function render(def: Def) {
  const run = () => {
    h.rt.i = 0;
    h.rt.effects = [];
    engine = useQuizEngine(def, COUNTRIES, 'world', 'all', 'random', abandon);
    for (const e of h.rt.effects) {
      for (const slot of h.rt.slots) {
        const s = slot as { pending?: unknown; cleanup?: void | (() => void) } | undefined;
        if (s?.pending === e.fn) { s.cleanup?.(); s.cleanup = e.fn(); s.pending = undefined; }
      }
    }
  };
  h.rt.rerender = run;
  run();
}
const abandon = vi.fn();

const keyEvent = (key: string, extra: Record<string, unknown> = {}) => ({
  key, ctrlKey: false, altKey: false, metaKey: false, isComposing: false,
  target: null, preventDefault: vi.fn(), ...extra,
});
const enterInInput = () => engine.onInputKeyDown(keyEvent('Enter') as never);
const type = (value: string) => engine.onInputChange({ target: { value } } as never);
const press = (e: ReturnType<typeof keyEvent>) => (listeners.keydown ?? []).slice().forEach(l => l(e));

beforeEach(() => {
  vi.useFakeTimers();
  h.rt.slots = [];
  h.review.mockClear();
  vi.mocked(saveQuizRun).mockClear();
  listeners = {};
  const target = {
    addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] ??= []).push(fn),
    removeEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = (listeners[t] ?? []).filter(l => l !== fn)),
  };
  Object.assign(globalThis, {
    window: { ...target, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval },
    document: target,
  });
  render({ id: 'capitals', facet: 'capital', match: (typed, t) => ({ accepted: typed === t.capital }), answerOf: t => t.capital ?? t.name });
  engine.start();
});

describe('Enter after a reveal', () => {
  it('fills the answer, then advances with outcome "revealed"', () => {
    const first = engine.target!;
    engine.reveal();
    enterInInput();
    expect(engine.input).toBe(first.capital);
    expect(engine.answeredCount).toBe(0); // not yet: the answer shows for a beat
    vi.advanceTimersByTime(REVEAL_FILL_MS);
    expect(engine.answered.get(first.iso3)).toBe('revealed');
    expect(engine.target).not.toBe(first);
    expect(engine.input).toBe('');
    expect(h.review).toHaveBeenCalledWith(expect.stringContaining(first.iso3), 'again');
  });

  it('also works with focus elsewhere (document-level Enter)', () => {
    const first = engine.target!;
    engine.reveal();
    press(keyEvent('Enter', { target: { closest: () => null } }));
    vi.advanceTimersByTime(REVEAL_FILL_MS);
    expect(engine.answered.get(first.iso3)).toBe('revealed');
  });

  it('does nothing when the target is not revealed', () => {
    const first = engine.target!;
    enterInInput();
    press(keyEvent('Enter', { target: { closest: () => null } }));
    vi.advanceTimersByTime(1000);
    expect(engine.target).toBe(first);
    expect(engine.input).toBe('');
    expect(engine.answeredCount).toBe(0);
  });

  it('still accepts the revealed answer typed by hand', () => {
    const first = engine.target!;
    engine.reveal();
    type(first.capital!);
    expect(engine.answered.get(first.iso3)).toBe('revealed');
    expect(engine.target).not.toBe(first);
  });

  it('finishes the run when the last target is filled in', () => {
    for (let n = 0; n < COUNTRIES.length; n++) {
      engine.reveal();
      enterInInput();
      vi.advanceTimersByTime(REVEAL_FILL_MS);
    }
    expect(engine.phase).toBe('done');
    expect(engine.result?.revealed).toHaveLength(COUNTRIES.length);
    expect(saveQuizRun).toHaveBeenCalledOnce();
  });
});

describe('Restart', () => {
  it('starts a clean run: nothing saved, nothing graded, progress cleared', () => {
    type(engine.target!.capital!); // one honest answer first
    engine.reveal();
    h.review.mockClear();
    engine.restart();
    expect(engine.phase).toBe('running');
    expect(engine.answeredCount).toBe(0);
    expect(engine.remainingCount).toBe(COUNTRIES.length);
    expect(engine.revealedSet.size).toBe(0);
    expect(engine.input).toBe('');
    expect(h.review).not.toHaveBeenCalled();
    expect(saveQuizRun).not.toHaveBeenCalled();
    expect(abandon).not.toHaveBeenCalled();
  });

  it('runs on a newly drawn set when given one, and finishes against it', () => {
    const fresh = [country('DDD', 'Dland', 'Delta City'), country('EEE', 'Eland', 'Eps City')];
    engine.restart(fresh);
    expect(engine.totalCount).toBe(2);
    expect(engine.remainingCount).toBe(2);
    expect(fresh).toContain(engine.target);
    for (let n = 0; n < 2; n++) type(engine.target!.capital!);
    expect(engine.phase).toBe('done');
    expect(engine.result?.firstTryCount).toBe(2);
  });

  it('drops a pending Enter fill', () => {
    engine.reveal();
    enterInInput();
    engine.restart();
    vi.advanceTimersByTime(REVEAL_FILL_MS * 2);
    expect(engine.answeredCount).toBe(0);
  });
});

describe('Review mistakes', () => {
  it('replays only the revealed countries and archives the time as the next try', async () => {
    const [missed] = COUNTRIES;
    for (let n = 0; n < COUNTRIES.length; n++) {
      if (engine.target!.iso3 === missed.iso3) {
        engine.reveal();
        enterInInput();
        vi.advanceTimersByTime(REVEAL_FILL_MS);
      } else type(engine.target!.capital!);
    }
    expect(engine.phase).toBe('done');
    expect(saveQuizRun).toHaveBeenCalledOnce();

    engine.reviewMistakes();
    expect(engine.reviewing).toBe(true);
    expect(engine.totalCount).toBe(1);
    expect(engine.target).toBe(missed);
    type(missed.capital!);
    expect(engine.phase).toBe('done');
    expect(saveQuizRun).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(addReviewTime).toHaveBeenCalledWith(7, expect.any(Number));
  });
});
