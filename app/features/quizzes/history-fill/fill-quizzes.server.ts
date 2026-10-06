import { HISTORY_COUNTRIES } from '~/features/history';
import { rawEntries } from '~/features/history/data/catalog.server';
import { fillQuizzesFromRaw, type FillQuiz } from './fill-quiz';

/** Every "fill the list" quiz (app/features/quizzes/history-fill/fill-quiz.ts) of every history country —
 *  one per row of fill-quiz-config.ts, its entries selected from the timeline by that row's
 *  filters. Build-time only, like the history catalog it reads. */
export function fillQuizzes(): FillQuiz[] {
  return HISTORY_COUNTRIES.flatMap(c => fillQuizzesFromRaw(rawEntries(c.slug), c.slug));
}
