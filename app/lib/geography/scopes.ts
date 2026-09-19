/**
 * Quiz scopes (which continent's countries a quiz draws from) and the size ladder that
 * adapts to each pool. Deliberately dependency-free — no `~` alias, no React, no Stage
 * components — because react-router.config.ts imports it directly to decide which
 * /quiz/:quizId/:scope/:size pages to prerender, and that file is loaded outside the app's
 * bundler. A country added to content/ therefore changes both the offered sizes and the
 * prerendered routes with no list to edit.
 */

/** Country `region` values, as emitted on every record by scripts/build-content.mjs. */
const SCOPE_REGIONS = {
  africa: 'Africa',
  asia: 'Asia',
  europe: 'Europe',
  americas: 'Americas',
  oceania: 'Oceania'
} as const;

export const QUIZ_SCOPES = ['world', 'africa', 'asia', 'europe', 'americas', 'oceania'] as const;
export type QuizScope = (typeof QUIZ_SCOPES)[number];

export const SCOPE_LABELS: Record<QuizScope, string> = {
  world: 'World',
  africa: 'Africa',
  asia: 'Asia',
  europe: 'Europe',
  americas: 'Americas',
  oceania: 'Oceania'
};

export function isQuizScope(value: string): value is QuizScope {
  return (QUIZ_SCOPES as readonly string[]).includes(value);
}

/** The fixed rungs of the ladder. A rung is offered only when strictly smaller than the
 *  pool (a rung equal to the pool would just be "All" twice); "All" is always offered. */
export const SIZE_LADDER = [10, 20, 30, 50, 90, 120] as const;

/** The smallest rung is a continent-scale quiz: a top-10 of the whole 197-country world
 *  is not a quiz worth timing, and the catalogue's World row starts at 20 (the ladder
 *  before scopes existed). So the 10 rung only appears for pools this size or smaller.
 *  The strictly-smaller rule alone would have offered it to World too. */
const SMALLEST_RUNG = SIZE_LADDER[0];
const SMALLEST_RUNG_MAX_POOL = 100;
export type QuizSize = `${(typeof SIZE_LADDER)[number]}` | 'all';

export const QUIZ_SIZES: readonly QuizSize[] = [...SIZE_LADDER.map(n => String(n) as QuizSize), 'all'];

export function isQuizSize(value: string): value is QuizSize {
  return (QUIZ_SIZES as readonly string[]).includes(value);
}

/** The sizes offered for a pool of this many countries, ascending, "all" last. */
export function sizesForPool(poolSize: number): QuizSize[] {
  const rungs = SIZE_LADDER.filter(
    n => n < poolSize && (n !== SMALLEST_RUNG || poolSize <= SMALLEST_RUNG_MAX_POOL)
  );
  return [...rungs.map(n => String(n) as QuizSize), 'all'];
}

/** The countries a scope draws from — every country for "world", else those whose
 *  `region` matches. */
export function poolForScope<T extends { region: string }>(countries: T[], scope: QuizScope): T[] {
  if (scope === 'world') return countries;
  const region = SCOPE_REGIONS[scope];
  return countries.filter(c => c.region === region);
}
