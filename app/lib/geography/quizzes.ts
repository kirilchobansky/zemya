/**
 * The quiz catalogue. Today there is one quiz — "Name the Country" — but the shape below
 * (an entry describing itself, ranked by one exported function) is what lets a future
 * "Name the Capital" be a new entry in QUIZZES rather than a rewrite of /quiz.
 */
import type { CountryRecord } from '~/lib/map/types';

export const QUIZ_SIZES = ['20', '30', '50', '90', '120', 'all'] as const;
export type QuizSize = (typeof QUIZ_SIZES)[number];

export function isQuizSize(value: string): value is QuizSize {
  return (QUIZ_SIZES as readonly string[]).includes(value);
}

export interface QuizDef {
  id: string;
  title: string;
  description: string;
}

export const QUIZZES: QuizDef[] = [
  {
    id: 'countries',
    title: 'Name the Country',
    description: 'The map flies to a country. Type its name before the timer runs out of countries to ask.'
  }
];

/** The N most populous countries — the axis "Name the Country" ranks by. Kept behind one
 *  function so ranking by a different axis (area, alphabetical, ...) for a future quiz is
 *  a one-line change here, not a rewrite of the run screen. */
export function topByPopulation(countries: CountryRecord[], size: QuizSize): CountryRecord[] {
  const sorted = [...countries].sort((a, b) => b.population - a.population);
  return size === 'all' ? sorted : sorted.slice(0, Number(size));
}
