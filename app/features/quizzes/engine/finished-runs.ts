/**
 * A finished quiz run's results (geography engine or Name all countries), kept in memory so they survive a trip to a country dossier
 * and back (the run route unmounts on the way). Keyed by the run's URL (path + search), holding the
 * one latest entry per run under the token the dossier's Back carries. Not persisted: a reload
 * loses it and the run falls back to its start screen. Restoring writes nothing to the archive,
 * FSRS or the personal best — the results were saved once, when the run finished.
 */
import type { CountryRecord } from '~/engines/map/types';
import type { QuizRunResult } from './types';

export interface FinishedRun {
  result: QuizRunResult;
  /** The set the finished run was played on (a review pass's smaller set included). */
  countries: CountryRecord[];
  revealedSet: ReadonlySet<string>;
  reviewing: boolean;
  /** The whole run's countries when this was a review pass over part of them; null otherwise. */
  fullList: CountryRecord[] | null;
  /** The full run's archive row, which a later review pass appends its time to. */
  savedRun: Promise<number | undefined>;
}

const saved = new Map<string, { token: string; run: unknown }>();

export function newFinishedRunToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function saveFinishedRun(key: string, token: string, run: unknown): void {
  saved.set(key, { token, run });
}

/** The results saved under this key, only if `token` is the one that was saved with them. */
export function savedFinishedRun<T = FinishedRun>(key: string, token: string | null): T | null {
  const entry = saved.get(key);
  return token && entry?.token === token ? (entry.run as T) : null;
}

/** Set when a results link is followed: the quiz screen leaving for a dossier keeps the camera on
 *  the scope (Africa stays Africa) instead of going home to the world. Short-lived, so a link
 *  opened in another tab cannot suppress a later, ordinary leave. */
let heldAt = 0;
export function holdQuizCamera(): void {
  heldAt = Date.now();
}
export function quizCameraHeld(): boolean {
  return Date.now() - heldAt < 1500;
}
