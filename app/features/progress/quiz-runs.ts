/**
 * The quiz-run archive: one row per finished run (plus its review passes), the personal
 * best derived from it. Persistence plumbing lives in progress.ts.
 */
import { database, shrug } from './progress';

/** A run under this many ms per country is not a real score — nobody types a country's
 *  name that fast. Exists because a timer bug once recorded a 1-second, 20-country run as
 *  a "personal best"; see saveQuizRun. Keep this well under what a genuinely fast player
 *  could do — it must only catch the impossible, never the merely excellent. */
const MIN_MS_PER_COUNTRY = 300;

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
  /** 'random' | 'population'; absent on older rows and on Name all, read as 'random'. */
  mode?: string;
  timeMs: number;
  totalCount: number;
  firstTryCount: number;
  revealedCount: number;
  /** Nothing revealed or skipped — only such a run can be a best. Older rows: see isPerfect. */
  perfect?: boolean;
  /** Epoch ms. */
  at: number;
  /** Times of the "Review mistakes" passes that followed this run: [second try, third try, ...].
   *  `timeMs` stays the first try. Absent when no review was played. */
  reviewTimesMs?: number[];
}

/** Fire-and-forget, like saveCard/logReview — the UI never waits on this write. Refuses
 *  to record a run faster than MIN_MS_PER_COUNTRY per country: this is a guard against a
 *  broken timer, not a substitute for the delete control on the quiz catalogue — it only
 *  catches runs that are outright impossible. */
export function saveQuizRun(
  entry: Omit<QuizRunEntry, 'id' | 'scope'> & { scope: string }
): Promise<number | undefined> {
  const store = database();
  if (!store) return Promise.resolve(undefined);
  const floorMs = entry.totalCount * MIN_MS_PER_COUNTRY;
  if (entry.timeMs < floorMs) {
    console.warn(
      `[progress] discarding an impossible quiz run: ${entry.timeMs}ms for ${entry.totalCount} ` +
        `countries (under the ${floorMs}ms floor) — this is a timer bug, not a score`
    );
    return Promise.resolve(undefined);
  }
  return store.quizRuns
    .add(entry as QuizRunEntry)
    .then(id => Number(id))
    .catch(error => {
      shrug('quiz run write')(error);
      return undefined;
    });
}

/** Appends one review pass (second try, third try, ...) to a saved run. Fire-and-forget. */
export function addReviewTime(id: number | undefined, timeMs: number): void {
  const store = database();
  if (!store || id === undefined) return;
  store.quizRuns
    .where('id')
    .equals(id)
    .modify(row => {
      row.reviewTimesMs = [...(row.reviewTimesMs ?? []), timeMs];
    })
    .catch(shrug('quiz run review write'));
}

/** Rows written before continent scopes existed have no `scope` field, and every one of
 *  them was a run over the whole world. Read a missing scope as 'world' at read time rather
 *  than migrating old rows: filtering on scope strictly would silently hide every personal
 *  best recorded so far, and rewriting rows would touch data the user owns for no gain. */
function runScope(run: Pick<QuizRunEntry, 'scope'>): string {
  return run.scope ?? 'world';
}

const isPerfect = (run: QuizRunEntry) => run.perfect ?? run.firstTryCount === run.totalCount;

/** The fastest PERFECT time for this quiz, scope, size (and mode), or null — the archive keeps
 *  every run, a best is only a clean one. Reads the live table, so deleteQuizRun self-corrects it. */
export async function bestQuizTime(quizId: string, scope: string, size: string, mode?: string): Promise<number | null> {
  const matching = (await quizRunsFor(quizId, scope, size)).filter(r => isPerfect(r) && inMode(r, mode));
  return matching.length ? Math.min(...matching.map(r => r.timeMs)) : null;
}

/** Every recorded run of a quiz scope (narrowed by size and mode when given), newest first. */
export async function listQuizRuns(quizId: string, scope: string, size: string | undefined, mode?: string): Promise<QuizRunEntry[]> {
  const matching = (await quizRunsFor(quizId, scope, size)).filter(r => inMode(r, mode));
  return matching.sort((a, b) => b.at - a.at);
}

const inMode = (run: Pick<QuizRunEntry, 'mode'>, mode?: string) => mode === undefined || (run.mode ?? 'random') === mode;

async function quizRunsFor(quizId: string, scope: string, size?: string): Promise<QuizRunEntry[]> {
  const store = database();
  if (!store) return [];
  try {
    const runs = await store.quizRuns.where('quizId').equals(quizId).toArray();
    return runs.filter(r => (size === undefined || r.size === size) && runScope(r) === scope);
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

