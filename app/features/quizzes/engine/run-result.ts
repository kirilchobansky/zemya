/**
 * Scoring a finished run: how many answers were first-try, which were revealed, whether it
 * beat the previous best. Pure.
 */
import type { CountryRecord } from '~/engines/map/types';
import { addReviewTime, saveQuizRun, type QuizRunEntry } from '~/features/progress';
import type { QuizOutcome, QuizRunResult } from './types';

export function scoreRun(
  countries: readonly CountryRecord[],
  revealedSet: ReadonlySet<string>,
  priorBest: number | null,
  finalElapsedMs: number,
  skippedCount: number,
  gaveUp = false
): { result: QuizRunResult; firstTryCount: number; revealedCount: number; perfect: boolean } {
  const revealedCountries = countries.filter(c => revealedSet.has(c.iso3));
  const firstTryCount = countries.length - revealedCountries.length;
  const perfect = !gaveUp && revealedCountries.length === 0 && skippedCount === 0;
  const beatBest = perfect && (priorBest === null || finalElapsedMs < priorBest);
  return {
    result: { timeMs: finalElapsedMs, firstTryCount, revealed: revealedCountries, beatBest, perfect, previousBest: priorBest, gaveUp },
    firstTryCount,
    perfect,
    revealedCount: revealedCountries.length
  };
}

/** Archives a finished run. A review pass writes no row of its own: its time is appended to the
 *  full run's row (`previous`, resolving to that row's id) as the next try. Returns the id of the
 *  row later reviews append to. */
export function archiveRun(
  previous: Promise<number | undefined>,
  reviewing: boolean,
  entry: Omit<QuizRunEntry, 'id'> & { scope: string }
): Promise<number | undefined> {
  if (!reviewing) return saveQuizRun(entry);
  previous.then(id => addReviewTime(id, entry.timeMs, entry.revealedCount));
  return previous;
}

/** What the map paints for a run: its own answers, plus — in a review pass over part of a run —
 *  every other country of the full run as answered, so only the ones under review start unmarked. */
export function settledMarks(
  reviewing: boolean,
  fullList: readonly CountryRecord[] | null,
  countries: readonly CountryRecord[],
  answered: ReadonlyMap<string, QuizOutcome>
): ReadonlyMap<string, QuizOutcome> {
  if (!reviewing || !fullList) return answered;
  const inReview = new Set(countries.map(c => c.iso3));
  const marks = new Map<string, QuizOutcome>();
  for (const c of fullList) if (!inReview.has(c.iso3)) marks.set(c.iso3, 'correct');
  for (const [iso3, outcome] of answered) marks.set(iso3, outcome);
  return marks;
}
