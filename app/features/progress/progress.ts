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

/** Bump for a breaking row shape, or for adding a table to the export payload — not the
 *  same number as the Dexie schema version below, which tracks the local IndexedDB shape
 *  instead. `parseExport` accepts any payload at or below this number (an older export is
 *  just missing newer optional fields, like `quizRuns`); it only rejects one from a
 *  version this build has never heard of. Bumped to 2 when quizRuns joined the payload. */
export const SCHEMA_VERSION = 2;

/** A run under this many ms per country is not a real score — nobody types a country's
 *  name that fast. Exists because a timer bug once recorded a 1-second, 20-country run as
 *  a "personal best"; see saveQuizRun. Keep this well under what a genuinely fast player
 *  could do — it must only catch the impossible, never the merely excellent. */
const MIN_MS_PER_COUNTRY = 300;

const DB_NAME = 'zemya-progress';

interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * One finished quiz run, appended — never overwritten, so a history exists (surfaced on
 * the quiz catalogue, alongside the fastest time). `quizId`/`size` are opaque strings here
 * for the same reason card ids are: this file must not need to know what "countries"
 * means, so a future history quiz can log runs into the same table.
 */
export interface QuizRunEntry {
  id?: number;
  quizId: string;
  /** Which pool the run drew from (world, africa, ...). Absent on every row written
   *  before scopes existed — those are all world runs, see runScope. */
  scope?: string;
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

/** Fire-and-forget, like saveCard/logReview — the UI never waits on this write. Refuses
 *  to record a run faster than MIN_MS_PER_COUNTRY per country: this is a guard against a
 *  broken timer, not a substitute for the delete control on the quiz catalogue — it only
 *  catches runs that are outright impossible. */
export function saveQuizRun(entry: Omit<QuizRunEntry, 'id' | 'scope'> & { scope: string }): void {
  const store = database();
  if (!store) return;
  const floorMs = entry.totalCount * MIN_MS_PER_COUNTRY;
  if (entry.timeMs < floorMs) {
    console.warn(
      `[progress] discarding an impossible quiz run: ${entry.timeMs}ms for ${entry.totalCount} ` +
        `countries (under the ${floorMs}ms floor) — this is a timer bug, not a score`
    );
    return;
  }
  store.quizRuns.add(entry as QuizRunEntry).catch(shrug('quiz run write'));
}

/** Rows written before continent scopes existed have no `scope` field, and every one of
 *  them was a run over the whole world. Read a missing scope as 'world' at read time rather
 *  than migrating old rows: filtering on scope strictly would silently hide every personal
 *  best recorded so far, and rewriting rows would touch data the user owns for no gain. */
function runScope(run: Pick<QuizRunEntry, 'scope'>): string {
  return run.scope ?? 'world';
}

/** The fastest recorded time for this quiz, scope and size, or null if none are left.
 *  Always reads the live table, so it self-corrects after deleteQuizRun with no extra
 *  bookkeeping. */
export async function bestQuizTime(quizId: string, scope: string, size: string): Promise<number | null> {
  const matching = await quizRunsFor(quizId, scope, size);
  return matching.length ? Math.min(...matching.map(r => r.timeMs)) : null;
}

/** Every recorded run for a quiz scope and size, most recent first — the catalogue's
 *  history list. */
export async function listQuizRuns(quizId: string, scope: string, size: string): Promise<QuizRunEntry[]> {
  const matching = await quizRunsFor(quizId, scope, size);
  return matching.sort((a, b) => b.at - a.at);
}

async function quizRunsFor(quizId: string, scope: string, size: string): Promise<QuizRunEntry[]> {
  const store = database();
  if (!store) return [];
  try {
    const runs = await store.quizRuns.where('quizId').equals(quizId).toArray();
    return runs.filter(r => r.size === size && runScope(r) === scope);
  } catch (error) {
    shrug('run history read')(error);
    return [];
  }
}

/** Deletes one run. The caller has already confirmed with the user — this is the whole
 *  point of the history list: the user's own data about their own performance, removable
 *  without a console. */
export async function deleteQuizRun(id: number): Promise<void> {
  const store = database();
  if (!store) return;
  try {
    await store.quizRuns.delete(id);
  } catch (error) {
    shrug('run delete')(error);
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
  /** Optional so a payload exported before schemaVersion 2 still parses — see
   *  parseExport's version check and importAll's merge. */
  quizRuns?: Omit<QuizRunEntry, 'id'>[];
}

/**
 * The review log is included even though mastery can be derived without it: it is the one
 * thing that cannot be reconstructed from anything else, and it is what a future FSRS
 * parameter optimisation would be fitted against. `id` is stripped from quizRuns — it is
 * a local IndexedDB auto-increment key, meaningless on another device and liable to
 * collide with an unrelated local row on import.
 */
export async function exportAll(): Promise<ExportPayload> {
  const store = database();
  const [cards, reviews, quizRuns] = store
    ? await Promise.all([store.cards.toArray(), store.reviews.toArray(), store.quizRuns.toArray()])
    : [[], [], []];
  return {
    app: 'zemya',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    cards,
    reviews: reviews.map(({ cardId, rating, at }) => ({ cardId, rating, at })),
    quizRuns: quizRuns.map(({ id, ...rest }) => { void id; return rest; })
  };
}

export class ImportError extends Error {}

/** Validate before touching anything — a bad paste must not be able to destroy progress.
 *  Accepts any schemaVersion at or below this build's — an older export is just missing
 *  newer optional fields (quizRuns) — and only rejects one from a version this build has
 *  never heard of. */
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
  if (typeof payload.schemaVersion !== 'number' || payload.schemaVersion > SCHEMA_VERSION) {
    throw new ImportError(
      `Export is schema version ${String(payload.schemaVersion)}; this build reads up to ${SCHEMA_VERSION}.`
    );
  }
  if (!Array.isArray(payload.cards) || !Array.isArray(payload.reviews)) {
    throw new ImportError('Export is missing its cards or reviews.');
  }
  if (payload.quizRuns !== undefined && !Array.isArray(payload.quizRuns)) {
    throw new ImportError('Export has a malformed quizRuns list.');
  }
  return payload as ExportPayload;
}

/** Replaces cards and reviews entirely. quizRuns is MERGED instead, deduplicated on
 *  (quizId, scope, size, at) — a run is an immutable historical fact, so importing an older
 *  backup must not delete runs recorded since it was taken. The caller has already
 *  confirmed with the user. */
export async function importAll(payload: ExportPayload): Promise<ProgressCard[]> {
  const store = database();
  if (!store) return payload.cards;
  await store.transaction('rw', store.cards, store.reviews, store.meta, store.quizRuns, async () => {
    await Promise.all([store.cards.clear(), store.reviews.clear()]);
    await store.cards.bulkAdd(payload.cards);
    await store.reviews.bulkAdd(payload.reviews);
    await store.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });

    if (payload.quizRuns?.length) {
      const existingKeys = new Set((await store.quizRuns.toArray()).map(quizRunKey));
      const toAdd = payload.quizRuns.filter(run => !existingKeys.has(quizRunKey(run)));
      if (toAdd.length) await store.quizRuns.bulkAdd(toAdd as QuizRunEntry[]);
    }
  });
  return payload.cards;
}

function quizRunKey(run: Pick<QuizRunEntry, 'quizId' | 'size' | 'at'>): string {
  return `${run.quizId} ${run.size} ${run.at}`;
}

export async function resetAll(): Promise<void> {
  const store = database();
  if (!store) return;
  await store.transaction('rw', store.cards, store.reviews, store.quizRuns, async () => {
    await Promise.all([store.cards.clear(), store.reviews.clear(), store.quizRuns.clear()]);
  });
}
