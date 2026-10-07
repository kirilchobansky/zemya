/**
 * Data shapes of the quiz list pages (the routes' loaders produce them) and the pool-size
 * calculation behind the size ladders.
 */
import { poolForQuiz, QUIZ_SCOPES, type QuizScope, type QuizSize } from '~/features/countries';
import { subjectById } from '../engine/subjects';

export type ScopeCounts = Record<QuizScope, number>;
/** Pool sizes per quiz id, then scope — a facet quiz's pool is narrower than the continent's
 *  (a missing or disputed value is out), so the size ladder is per quiz, not per scope. */
export type PoolCounts = Record<string, ScopeCounts>;

/** One row of History's list: enough to draw and link a "fill the list" quiz, without
 *  shipping every entry to a page that only lists them. */
export interface FillSummary {
  id: string;
  slug: string;
  title: string;
  kind: "ruler" | "government";
  count: number;
}

export interface ListData {
  scopeCounts: PoolCounts;
  fill: FillSummary[];
}

/** Every quiz's pool size per scope, from a country list — the size ladders are derived
 *  from these. */
export function poolCounts(countries: Parameters<typeof poolForQuiz>[0]): PoolCounts {
  const ids = [...(subjectById("geography")?.quizzes ?? []).map((q) => q.id), ...(subjectById("geography")?.extraQuizzes ?? []).map((q) => q.id)];
  return Object.fromEntries(
    ids.map((id) => [
      id,
      Object.fromEntries(
        QUIZ_SCOPES.map((scope) => [scope, poolForQuiz(countries, id, scope).length]),
      ) as ScopeCounts,
    ]),
  );
}

/** dd.mm.yyyy, whatever the browser's locale. */
export function formatRunDate(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export const bestKey = (quizId: string, scope: QuizScope, size: QuizSize) =>
  `${quizId}:${scope}:${size}`;

/** Must match .quiz-sizes' column count in quiz-list.css — passed in as --cols so the CSS
 *  min-height and this row count are computed from the same number. */
export const SIZE_COLUMNS = 3;

