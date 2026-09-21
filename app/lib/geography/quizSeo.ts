/**
 * Title and description for one quiz page, generated from (quiz, scope, size) — every
 * combination targets a different query ("Africa capitals quiz"), so none may share a
 * title. Pure and dependency-free so the unit tests can pin it down.
 */
import { SCOPE_LABELS, type QuizScope, type QuizSize } from '~/lib/geography/scopes';

interface QuizNaming {
  seoName: string;
  seoTask: string;
}

/** "Top 20" not "20": the numeric sizes are the N most populous of the pool
 *  (topByPopulation), and the title should say so. */
function countLabel(size: QuizSize, poolSize: number): string {
  return size === 'all' ? `All ${poolSize} Countries` : `Top ${size} Countries`;
}

export function quizPageSeo(
  quiz: QuizNaming,
  scope: QuizScope,
  size: QuizSize,
  poolSize: number
): { title: string; description: string } {
  const scopeLabel = SCOPE_LABELS[scope];
  const count = size === 'all' ? poolSize : Number(size);
  const which = size === 'all' ? `all ${count}` : `the ${count} most populous`;
  const where = scope === 'world' ? '' : `${scopeLabel} `;
  return {
    title: `${scopeLabel} ${quiz.seoName} Quiz — ${countLabel(size, poolSize)} | Zemya`,
    description:
      `${scopeLabel} ${quiz.seoName.toLowerCase()} quiz covering ${which} ${where}countries. ` +
      `${quiz.seoTask} Answers are typed and the run is timed. No sign-up.`
  };
}
