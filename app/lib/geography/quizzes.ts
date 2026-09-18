/**
 * The quiz catalogue: the size ladder every quiz shares, and the registry of
 * QuizDefinitions the shared engine/route (app/lib/quiz/engine.ts,
 * routes/quiz.$quizId.tsx) run. A second quiz is one entry in QUIZ_DEFINITIONS, never a
 * new route tree — see CLAUDE.md's Quizzes section.
 */
import { CountriesStage } from '~/components/quiz/CountriesStage';
import type { QuizDefinition } from '~/lib/quiz/types';
import type { CountryRecord } from '~/lib/map/types';

export const QUIZ_SIZES = ['20', '30', '50', '90', '120', 'all'] as const;
export type QuizSize = (typeof QUIZ_SIZES)[number];

export function isQuizSize(value: string): value is QuizSize {
  return (QUIZ_SIZES as readonly string[]).includes(value);
}

export const QUIZ_DEFINITIONS: QuizDefinition[] = [
  {
    id: 'countries',
    title: 'Name the Country',
    description: 'The map flies to a country. Type its name before the timer runs out of countries to ask.',
    facet: 'location',
    Stage: CountriesStage
  }
];

export function quizDefinition(id: string): QuizDefinition | undefined {
  return QUIZ_DEFINITIONS.find(q => q.id === id);
}

/** The N most populous countries — the axis "Name the Country" ranks by. Kept behind one
 *  function so ranking by a different axis (area, alphabetical, ...) for a future quiz is
 *  a one-line change here, not a rewrite of the run screen. */
export function topByPopulation(countries: CountryRecord[], size: QuizSize): CountryRecord[] {
  const sorted = [...countries].sort((a, b) => b.population - a.population);
  return size === 'all' ? sorted : sorted.slice(0, Number(size));
}
