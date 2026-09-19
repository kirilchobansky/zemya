/**
 * Unit tests for app/lib/core/progress.ts's quizRuns table: the reset gap that let a
 * timer-bug best time survive a "reset all progress", the impossible-run guard, and the
 * export/import merge behaviour.
 *
 * `available()` gates every entry point on `typeof indexedDB !== 'undefined'`, so a
 * fake-indexeddb polyfill loaded before any call (not necessarily before the import,
 * since nothing here touches indexedDB at module scope — see progress.ts's own doc
 * comment) is enough to exercise the real Dexie code path in plain Node.
 *
 *   npm run test:unit
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  bestQuizTime,
  deleteQuizRun,
  importAll,
  listQuizRuns,
  resetAll,
  saveQuizRun,
  SCHEMA_VERSION,
  type ExportPayload,
  type QuizRunEntry
} from '~/lib/core/progress';

const QUIZ_ID = 'countries';
const SCOPE = 'world';
const SIZE = '20';
const TOTAL = 20;

/** saveQuizRun is fire-and-forget by design (see its own doc comment) — give its
 *  underlying IndexedDB write a tick to settle before asserting on it. */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 20));
}

function runEntry(
  overrides: Partial<Omit<QuizRunEntry, 'id'>> = {}
): Omit<QuizRunEntry, 'id' | 'scope'> & { scope: string } {
  return {
    quizId: QUIZ_ID,
    scope: SCOPE,
    size: SIZE,
    timeMs: 60_000,
    totalCount: TOTAL,
    firstTryCount: TOTAL,
    revealedCount: 0,
    at: Date.now(),
    ...overrides
  };
}

beforeEach(async () => {
  await resetAll();
});

describe('resetAll', () => {
  it('clears quizRuns along with cards and reviews', async () => {
    saveQuizRun(runEntry());
    await flush();
    expect(await bestQuizTime(QUIZ_ID, SCOPE, SIZE)).not.toBeNull();

    await resetAll();

    expect(await bestQuizTime(QUIZ_ID, SCOPE, SIZE)).toBeNull();
    expect(await listQuizRuns(QUIZ_ID, SCOPE, SIZE)).toEqual([]);
  });
});

describe('saveQuizRun — the impossible-run guard', () => {
  it('discards a run under ~0.3s/country; keeps one right at the floor', async () => {
    const floorMs = TOTAL * 300; // 6000ms for a 20-country run

    saveQuizRun(runEntry({ timeMs: floorMs - 1, at: 1 }));
    await flush();
    expect(await bestQuizTime(QUIZ_ID, SCOPE, SIZE)).toBeNull();

    saveQuizRun(runEntry({ timeMs: floorMs, at: 2 }));
    await flush();
    expect(await bestQuizTime(QUIZ_ID, SCOPE, SIZE)).toBe(floorMs);
  });

  it('the 1-second, 20-country run that motivated this guard is rejected', async () => {
    saveQuizRun(runEntry({ timeMs: 1000, at: 3 }));
    await flush();
    expect(await bestQuizTime(QUIZ_ID, SCOPE, SIZE)).toBeNull();
  });
});

describe('bestQuizTime — recomputed live, never cached', () => {
  it('tracks the minimum as runs are deleted, and returns null once none are left', async () => {
    saveQuizRun(runEntry({ timeMs: 50_000, at: 10 }));
    saveQuizRun(runEntry({ timeMs: 30_000, at: 11 }));
    await flush();
    expect(await bestQuizTime(QUIZ_ID, SCOPE, SIZE)).toBe(30_000);

    const runs = await listQuizRuns(QUIZ_ID, SCOPE, SIZE);
    const fastest = runs.find(r => r.timeMs === 30_000)!;
    await deleteQuizRun(fastest.id!);

    expect(await bestQuizTime(QUIZ_ID, SCOPE, SIZE)).toBe(50_000);

    const remaining = await listQuizRuns(QUIZ_ID, SCOPE, SIZE);
    await deleteQuizRun(remaining[0].id!);

    expect(await bestQuizTime(QUIZ_ID, SCOPE, SIZE)).toBeNull();
  });
});

describe('importAll — quizRuns is merged, not replaced', () => {
  const basePayload: Omit<ExportPayload, 'quizRuns'> = {
    app: 'zemya',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    cards: [],
    reviews: []
  };

  it('keeps runs already on this device and adds the imported ones', async () => {
    saveQuizRun(runEntry({ timeMs: 40_000, at: 100 }));
    await flush();

    await importAll({ ...basePayload, quizRuns: [runEntry({ timeMs: 35_000, at: 200 })] });

    const runs = await listQuizRuns(QUIZ_ID, SCOPE, SIZE);
    expect(runs.map(r => r.at).sort()).toEqual([100, 200]);
  });

  it('deduplicates on (quizId, size, at) — importing the same export twice does not double it', async () => {
    const payload: ExportPayload = { ...basePayload, quizRuns: [runEntry({ timeMs: 45_000, at: 300 })] };

    await importAll(payload);
    await importAll(payload);

    const runs = await listQuizRuns(QUIZ_ID, SCOPE, SIZE);
    expect(runs.filter(r => r.at === 300)).toHaveLength(1);
  });

  it('accepts a payload from before quizRuns existed (schemaVersion 1, no quizRuns field)', async () => {
    const oldPayload = { app: 'zemya' as const, schemaVersion: 1, exportedAt: new Date().toISOString(), cards: [], reviews: [] };

    await expect(importAll(oldPayload)).resolves.not.toThrow();
    expect(await listQuizRuns(QUIZ_ID, SCOPE, SIZE)).toEqual([]);
  });
});

describe('personal bests are keyed by (quizId, scope, size) — and pre-scope runs still count as world', () => {
  /** A row exactly as written before scopes existed: no `scope` field at all. Arrives via
   *  importAll, the one public path that stores a row verbatim, the way an old backup would. */
  const preScopeRun = (overrides: Partial<Omit<QuizRunEntry, 'id' | 'scope'>> = {}) => {
    const { scope, ...rest } = runEntry(overrides);
    void scope;
    return rest;
  };
  const withRuns = (quizRuns: ExportPayload['quizRuns']): ExportPayload => ({
    app: 'zemya', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(),
    cards: [], reviews: [], quizRuns
  });

  it('bestQuizTime finds a run with no scope field when asked for world', async () => {
    await importAll(withRuns([preScopeRun({ timeMs: 47_000, at: 500 })]));
    expect(await bestQuizTime(QUIZ_ID, 'world', SIZE)).toBe(47_000);
    expect((await listQuizRuns(QUIZ_ID, 'world', SIZE)).map(r => r.timeMs)).toEqual([47_000]);
  });

  it('a pre-scope run is not counted for any other scope', async () => {
    await importAll(withRuns([preScopeRun({ timeMs: 47_000, at: 501 })]));
    expect(await bestQuizTime(QUIZ_ID, 'africa', SIZE)).toBeNull();
  });

  it('a new run is written with its scope and only counts for that scope', async () => {
    saveQuizRun(runEntry({ scope: 'oceania', size: 'all', totalCount: 14, timeMs: 40_000, at: 502 }));
    await flush();
    expect(await bestQuizTime(QUIZ_ID, 'oceania', 'all')).toBe(40_000);
    expect(await bestQuizTime(QUIZ_ID, 'world', 'all')).toBeNull();
    expect((await listQuizRuns(QUIZ_ID, 'oceania', 'all'))[0].scope).toBe('oceania');
  });

  it('world takes the fastest across old (scope-less) and new rows alike', async () => {
    await importAll(withRuns([preScopeRun({ timeMs: 50_000, at: 503 })]));
    saveQuizRun(runEntry({ timeMs: 45_000, at: 504 }));
    await flush();
    expect(await bestQuizTime(QUIZ_ID, 'world', SIZE)).toBe(45_000);
  });

  it('importing the same old export twice still does not double a scope-less run', async () => {
    const payload = withRuns([preScopeRun({ timeMs: 47_000, at: 505 })]);
    await importAll(payload);
    await importAll(payload);
    expect(await listQuizRuns(QUIZ_ID, 'world', SIZE)).toHaveLength(1);
  });
});
