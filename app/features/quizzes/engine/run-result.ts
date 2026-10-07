/**
 * Scoring a finished run: how many answers were first-try, which were revealed, whether it
 * beat the previous best. Pure.
 */
import type { CountryRecord } from '~/engines/map/types';
import { addReviewTime, saveQuizRun, type QuizRunEntry } from '~/features/progress';
import type { QuizRunResult } from './types';

export function scoreRun(
  countries: readonly CountryRecord[],
  revealedSet: ReadonlySet<string>,
  priorBest: number | null,
  finalElapsedMs: number,
  skippedCount: number
): { result: QuizRunResult; firstTryCount: number; revealedCount: number; perfect: boolean } {
  const revealedCountries = countries.filter(c => revealedSet.has(c.iso3));
  const firstTryCount = countries.length - revealedCountries.length;
  const perfect = revealedCountries.length === 0 && skippedCount === 0;
  const beatBest = perfect && (priorBest === null || finalElapsedMs < priorBest);
  return {
    result: { timeMs: finalElapsedMs, firstTryCount, revealed: revealedCountries, beatBest, perfect, previousBest: priorBest },
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
  previous.then(id => addReviewTime(id, entry.timeMs));
  return previous;
}
