/**
 * Shared harness of the engine hook tests: `react` replaced by a ~40-line hook runtime (state,
 * refs, memoised callbacks, effects run after each render) and `window`/`document` by bare event
 * targets — enough to drive the real engine code, not a copy of it. Used through
 * `vi.mock('react', ...)` in engine.test.ts and engine-run.test.ts.
 */
import { vi } from 'vitest';

import type { CountryRecord } from '~/engines/map/types';
import type { QuizEngine, useQuizEngine } from './engine';

function build() {
  const rt = {
    slots: [] as unknown[],
    setters: {} as Record<number, unknown>,
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
        // like React's, the setter is the same function on every render
        const set = (rt.setters[k] ??= (v: T | ((p: T) => T)) => {
          const next = typeof v === 'function' ? (v as (p: T) => T)(rt.slots[k] as T) : v;
          if (!Object.is(next, rt.slots[k])) { rt.slots[k] = next; rt.rerender(); }
        }) as (v: T | ((p: T) => T)) => void;
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
      useMemo<T>(fn: () => T, deps: unknown[]) {
        const k = rt.i++;
        const prev = rt.slots[k] as { value: T; deps: unknown[] } | undefined;
        if (prev && same(prev.deps, deps)) return prev.value;
        const value = fn();
        rt.slots[k] = { value, deps };
        return value;
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
}

export const h = build();

export const country = (iso3: string, name: string, capital: string): CountryRecord =>
  ({
    id: iso3, iso3, iso2: iso3.slice(0, 2), slug: name.toLowerCase(), name, aliases: [name], capital,
    capitalAliases: [capital], languages: ['Alpha', 'Beta'], religion: 'None', currencyName: null, currencyCode: null,
  }) as unknown as CountryRecord;

export const COUNTRIES = [country('AAA', 'Aland', 'Alpha City'), country('BBB', 'Bland', 'Beta City'), country('CCC', 'Cland', 'Gamma City')];

export type Def = Parameters<typeof useQuizEngine>[0];
/** The hook under test, set by the test file (importing it here would load `react` before its mock). */
export const under = { hook: null as unknown as typeof useQuizEngine };
export const ctx = { engine: null as unknown as QuizEngine, listeners: {} as Record<string, ((e: unknown) => void)[]> };
export const abandon = vi.fn();

/** Renders the hook, then runs the effects its render queued (cleanups first, like React). */
export function render(def: Def) {
  const run = () => {
    h.rt.i = 0;
    h.rt.effects = [];
    ctx.engine = under.hook(def, COUNTRIES, 'world', 'all', 'random', abandon);
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

export const CAPITALS: Def = { id: 'capitals', facet: 'capital', match: (typed, t) => ({ accepted: typed === t.capital }), answerOf: t => t.capital ?? t.name };

export const keyEvent = (key: string, extra: Record<string, unknown> = {}) => ({
  key, ctrlKey: false, altKey: false, metaKey: false, isComposing: false,
  target: null, preventDefault: vi.fn(), ...extra,
});

/** A fresh window/document and hook state; call in beforeEach. */
export function resetHarness() {
  vi.useFakeTimers();
  h.rt.slots = [];
  h.rt.setters = {};
  h.review.mockClear();
  ctx.listeners = {};
  const listeners = ctx.listeners;
  const target = {
    addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] ??= []).push(fn),
    removeEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = (listeners[t] ?? []).filter(l => l !== fn)),
  };
  Object.assign(globalThis, {
    window: { ...target, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval },
    document: target,
  });
}
