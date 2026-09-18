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
const SIZE = '20';
const TOTAL = 20;

/** saveQuizRun is fire-and-forget by design (see its own doc comment) — give its
 *  underlying IndexedDB write a tick to settle before asserting on it. */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 20));
}

function runEntry(overrides: Partial<Omit<QuizRunEntry, 'id'>> = {}): Omit<QuizRunEntry, 'id'> {
  return {
    quizId: QUIZ_ID,
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
    expect(await bestQuizTime(QUIZ_ID, SIZE)).not.toBeNull();

    await resetAll();

    expect(await bestQuizTime(QUIZ_ID, SIZE)).toBeNull();
    expect(await listQuizRuns(QUIZ_ID, SIZE)).toEqual([]);
  });
});

describe('saveQuizRun — the impossible-run guard', () => {
  it('discards a run under ~0.3s/country; keeps one right at the floor', async () => {
    const floorMs = TOTAL * 300; // 6000ms for a 20-country run

    saveQuizRun(runEntry({ timeMs: floorMs - 1, at: 1 }));
    await flush();
    expect(await bestQuizTime(QUIZ_ID, SIZE)).toBeNull();

    saveQuizRun(runEntry({ timeMs: floorMs, at: 2 }));
    await flush();
    expect(await bestQuizTime(QUIZ_ID, SIZE)).toBe(floorMs);
  });

  it('the 1-second, 20-country run that motivated this guard is rejected', async () => {
    saveQuizRun(runEntry({ timeMs: 1000, at: 3 }));
    await flush();
    expect(await bestQuizTime(QUIZ_ID, SIZE)).toBeNull();
  });
});

describe('bestQuizTime — recomputed live, never cached', () => {
  it('tracks the minimum as runs are deleted, and returns null once none are left', async () => {
    saveQuizRun(runEntry({ timeMs: 50_000, at: 10 }));
    saveQuizRun(runEntry({ timeMs: 30_000, at: 11 }));
    await flush();
    expect(await bestQuizTime(QUIZ_ID, SIZE)).toBe(30_000);

    const runs = await listQuizRuns(QUIZ_ID, SIZE);
    const fastest = runs.find(r => r.timeMs === 30_000)!;
    await deleteQuizRun(fastest.id!);

    expect(await bestQuizTime(QUIZ_ID, SIZE)).toBe(50_000);

    const remaining = await listQuizRuns(QUIZ_ID, SIZE);
    await deleteQuizRun(remaining[0].id!);

    expect(await bestQuizTime(QUIZ_ID, SIZE)).toBeNull();
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

    const runs = await listQuizRuns(QUIZ_ID, SIZE);
    expect(runs.map(r => r.at).sort()).toEqual([100, 200]);
  });

  it('deduplicates on (quizId, size, at) — importing the same export twice does not double it', async () => {
    const payload: ExportPayload = { ...basePayload, quizRuns: [runEntry({ timeMs: 45_000, at: 300 })] };

    await importAll(payload);
    await importAll(payload);

    const runs = await listQuizRuns(QUIZ_ID, SIZE);
    expect(runs.filter(r => r.at === 300)).toHaveLength(1);
  });

  it('accepts a payload from before quizRuns existed (schemaVersion 1, no quizRuns field)', async () => {
    const oldPayload = { app: 'zemya' as const, schemaVersion: 1, exportedAt: new Date().toISOString(), cards: [], reviews: [] };

    await expect(importAll(oldPayload)).resolves.not.toThrow();
    expect(await listQuizRuns(QUIZ_ID, SIZE)).toEqual([]);
  });
});
