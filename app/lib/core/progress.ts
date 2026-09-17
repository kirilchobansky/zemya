/**
 * Local-first persistence for scheduling state. Subject-agnostic: card ids are opaque
 * strings, so geography and, later, history share one database without collision.
 *
 * ## Two rules this file exists to enforce
 *
 * **Nothing here may run at module scope.** Route loaders run at build time during
 * prerender, where `indexedDB` does not exist. Importing this module from a route must be
 * inert — the Dexie instance is constructed on first use, behind `available()`, and every
 * entry point returns a harmless empty value when there is no IndexedDB. If `npm run build`
 * ever fails inside prerender, look here first.
 *
 * **Writes are never awaited by the UI.** `saveCard` and `logReview` return void and
 * swallow their own failures. Losing one review to a failed write is acceptable; a UI that
 * waits on disk is not. Only the explicit export / import / reset operations are async,
 * because the user asked for them and is watching.
 */
import Dexie, { type EntityTable } from 'dexie';

import type { ProgressCard, ReviewEntry } from './scheduler';

/** Bump only for a breaking row shape. Written into meta and into every export. Not the
 *  same number as the Dexie schema version below — quizRuns is additive (a new table,
 *  not a changed row shape) and deliberately left out of export/import (see QuizRunEntry's
 *  own doc comment), so it doesn't force this one to move. */
export const SCHEMA_VERSION = 1;

const DB_NAME = 'zemya-progress';

interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * One finished quiz run, appended — never overwritten, so a history exists later even
 * though only the fastest time is surfaced today. `quizId`/`size` are opaque strings here
 * for the same reason card ids are: this file must not need to know what "countries"
 * means, so a future history quiz can log runs into the same table.
 *
 * Deliberately NOT part of ExportPayload/SCHEMA_VERSION: a personal best is local flavour,
 * not learning progress, and keeping it out avoids forcing every existing export
 * incompatible over an additive table. Revisit if the owner wants best times to survive
 * a device move.
 */
export interface QuizRunEntry {
  id?: number;
  quizId: string;
  size: string;
  timeMs: number;
  totalCount: number;
  firstTryCount: number;
  revealedCount: number;
  /** Epoch ms. */
  at: number;
}

type ProgressDb = Dexie & {
  cards: EntityTable<ProgressCard, 'id'>;
  reviews: EntityTable<ReviewEntry & { seq?: number }, 'seq'>;
  meta: EntityTable<MetaRow, 'key'>;
  quizRuns: EntityTable<QuizRunEntry, 'id'>;
};

let db: ProgressDb | null = null;

/** True only in a browser. The single gate every export below passes through. */
function available(): boolean {
  return typeof indexedDB !== 'undefined';
}

function database(): ProgressDb | null {
  if (!available()) return null;
  if (!db) {
    const instance = new Dexie(DB_NAME) as ProgressDb;
    instance.version(1).stores({
      cards: 'id, due, state',
      reviews: '++seq, cardId, at',
      meta: 'key'
    });
    // Additive only — quizRuns is a new table, existing rows in the first three are
    // untouched, so no upgrade() callback is needed for Dexie to carry them forward.
    instance.version(2).stores({
      cards: 'id, due, state',
      reviews: '++seq, cardId, at',
      meta: 'key',
      quizRuns: '++id, quizId, size, at'
    });
    db = instance;
  }
  return db;
}

/** Fire-and-forget, like saveCard/logReview — the UI never waits on this write. */
export function saveQuizRun(entry: Omit<QuizRunEntry, 'id'>): void {
  const store = database();
  if (!store) return;
  store.quizRuns.add(entry as QuizRunEntry).catch(shrug('quiz run write'));
}

/** The fastest recorded time for this quiz size, or null if it has never been run. */
export async function bestQuizTime(quizId: string, size: string): Promise<number | null> {
  const store = database();
  if (!store) return null;
  try {
    const runs = await store.quizRuns.where('quizId').equals(quizId).toArray();
    const matching = runs.filter(r => r.size === size);
    return matching.length ? Math.min(...matching.map(r => r.timeMs)) : null;
  } catch (error) {
    shrug('best time read')(error);
    return null;
  }
}

function shrug(what: string): (error: unknown) => void {
  return error => console.warn(`[progress] ${what} failed, continuing`, error);
}

/**
 * Read every card into memory. Called once on mount; the in-memory map is the source of
 * truth for rendering from then on. A few thousand small rows is a single fast read, and
 * it removes IndexedDB from every subsequent render path.
 */
export async function loadCards(): Promise<ProgressCard[]> {
  const store = database();
  if (!store) return [];
  try {
    return await store.cards.toArray();
  } catch (error) {
    shrug('load')(error);
    return [];
  }
}

/** Fire-and-forget. Deliberately not async — callers must not be able to await it. */
export function saveCard(card: ProgressCard): void {
  const store = database();
  if (!store) return;
  store.cards.put(card).catch(shrug('card write'));
}

/** Fire-and-forget. The review log is append-only and never read on the hot path. */
export function logReview(entry: ReviewEntry): void {
  const store = database();
  if (!store) return;
  store.reviews.add(entry).catch(shrug('review log write'));
}

export interface ExportPayload {
  app: 'zemya';
  schemaVersion: number;
  exportedAt: string;
  cards: ProgressCard[];
  reviews: ReviewEntry[];
}

/**
 * The review log is included even though mastery can be derived without it: it is the one
 * thing that cannot be reconstructed from anything else, and it is what a future FSRS
 * parameter optimisation would be fitted against.
 */
export async function exportAll(): Promise<ExportPayload> {
  const store = database();
  const [cards, reviews] = store
    ? await Promise.all([store.cards.toArray(), store.reviews.toArray()])
    : [[], []];
  return {
    app: 'zemya',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    cards,
    reviews: reviews.map(({ cardId, rating, at }) => ({ cardId, rating, at }))
  };
}

export class ImportError extends Error {}

/** Validate before touching anything — a bad paste must not be able to destroy progress. */
export function parseExport(text: string): ExportPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('That is not valid JSON.');
  }
  if (!raw || typeof raw !== 'object') throw new ImportError('That is not a Zemya export.');
  const payload = raw as Partial<ExportPayload>;
  if (payload.app !== 'zemya') throw new ImportError('That is not a Zemya export.');
  if (payload.schemaVersion !== SCHEMA_VERSION) {
    throw new ImportError(
      `Export is schema version ${String(payload.schemaVersion)}; this build reads ${SCHEMA_VERSION}.`
    );
  }
  if (!Array.isArray(payload.cards) || !Array.isArray(payload.reviews)) {
    throw new ImportError('Export is missing its cards or reviews.');
  }
  return payload as ExportPayload;
}

/** Replaces everything. The caller has already confirmed with the user. */
export async function importAll(payload: ExportPayload): Promise<ProgressCard[]> {
  const store = database();
  if (!store) return payload.cards;
  await store.transaction('rw', store.cards, store.reviews, store.meta, async () => {
    await Promise.all([store.cards.clear(), store.reviews.clear()]);
    await store.cards.bulkAdd(payload.cards);
    await store.reviews.bulkAdd(payload.reviews);
    await store.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  });
  return payload.cards;
}

export async function resetAll(): Promise<void> {
  const store = database();
  if (!store) return;
  await store.transaction('rw', store.cards, store.reviews, async () => {
    await Promise.all([store.cards.clear(), store.reviews.clear()]);
  });
}
