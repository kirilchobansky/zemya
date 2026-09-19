/**
 * Quiz scopes (which continent's countries a quiz draws from) and the size ladder that
 * adapts to each pool. Deliberately dependency-free — no `~` alias, no React, no Stage
 * components — because react-router.config.ts imports it directly to decide which
 * /quiz/:quizId/:scope/:size pages to prerender, and that file is loaded outside the app's
 * bundler. A country added to content/ therefore changes both the offered sizes and the
 * prerendered routes with no list to edit.
 */

/** How each continent scope picks its countries, from the `region` / `subregion` fields on
 *  every record (scripts/build-content.mjs). North America is deliberately "every other
 *  Americas country" rather than a list of subregions: the Caribbean, Central America and
 *  Northern America all belong to it, and a subregion added upstream lands there too. */
interface CountryGeo {
  region: string;
  subregion: string;
}

const SCOPE_MEMBERS: Record<Exclude<QuizScope, 'world'>, (c: CountryGeo) => boolean> = {
  africa: c => c.region === 'Africa',
  asia: c => c.region === 'Asia',
  europe: c => c.region === 'Europe',
  'north-america': c => c.region === 'Americas' && c.subregion !== 'South America',
  'south-america': c => c.region === 'Americas' && c.subregion === 'South America',
  oceania: c => c.region === 'Oceania'
};

export const QUIZ_SCOPES = [
  'world', 'africa', 'asia', 'europe', 'north-america', 'south-america', 'oceania'
] as const;
export type QuizScope = (typeof QUIZ_SCOPES)[number];

export const SCOPE_LABELS: Record<QuizScope, string> = {
  world: 'World',
  africa: 'Africa',
  asia: 'Asia',
  europe: 'Europe',
  'north-america': 'North America',
  'south-america': 'South America',
  oceania: 'Oceania'
};

/** Where a continent's quiz keeps the camera — [minLon, minLat, maxLon, maxLat]. Hand-set
 *  rather than derived from the pool: a derived box would let Russia's far east, Hawaii or
 *  Kiribati's outliers drag the "continent view" out over open ocean. Oceania runs past
 *  180 on purpose (the camera wraps), so Fiji and New Zealand are not cut off. World has no
 *  entry: its view is the atlas's ordinary home. */
export const SCOPE_VIEWS: Partial<Record<QuizScope, [number, number, number, number]>> = {
  africa: [-20, -36, 52, 38],
  asia: [25, -11, 146, 55],
  europe: [-25, 34, 50, 72],
  'north-america': [-170, 7, -50, 72],
  'south-america': [-82, -56, -34, 13],
  oceania: [110, -48, 195, 5]
};

export function isQuizScope(value: string): value is QuizScope {
  return (QUIZ_SCOPES as readonly string[]).includes(value);
}

/** Scope keys that once existed and no longer do, and where a URL naming one now goes.
 *  "americas" was split into north-america and south-america; a run can't be attributed to
 *  either half, so the old page simply lands on the world scope. Its stored personal bests
 *  are orphaned (see progress.ts — an unknown scope matches nothing, it never throws). */
export const LEGACY_SCOPES: Record<string, QuizScope> = { americas: 'world' };

/** The rungs a size can come from — see sizesForPool for which of them a pool keeps. */
export const SIZE_LADDER = [10, 20, 30, 50, 90, 120] as const;
export type QuizSize = `${(typeof SIZE_LADDER)[number]}` | 'all';

export const QUIZ_SIZES: readonly QuizSize[] = [...SIZE_LADDER.map(n => String(n) as QuizSize), 'all'];

/** Lower bound: a size below this share of the pool is a trivial slice of it. It is why
 *  World (197) does not offer "top 10" — that's 5% of the world, not a quiz worth timing. */
const MIN_SHARE = 0.08;
/** Upper bound: a size above this share is so close to All that it is the same quiz twice.
 *  It is why Oceania (14) and South America (12) offer nothing but All. */
const MAX_SHARE = 0.68;

export function isQuizSize(value: string): value is QuizSize {
  return (QUIZ_SIZES as readonly string[]).includes(value);
}

/** The sizes offered for a pool of this many countries, ascending, "All" always last. A
 *  ladder rung S is kept when MIN_SHARE * N <= S <= MAX_SHARE * N. Computed, never listed:
 *  a country added to content/ moves the pools, and the sizes follow. Compared in integer
 *  percent (100 * S against 8 * N) so a boundary case can't be lost to float rounding. */
export function sizesForPool(poolSize: number): QuizSize[] {
  const minPct = Math.round(MIN_SHARE * 100);
  const maxPct = Math.round(MAX_SHARE * 100);
  const kept = SIZE_LADDER.filter(n => 100 * n >= minPct * poolSize && 100 * n <= maxPct * poolSize);
  return [...kept.map(n => String(n) as QuizSize), 'all'];
}

/** The countries a scope draws from — every country for "world", else those the scope's
 *  membership test accepts. */
export function poolForScope<T extends CountryGeo>(countries: T[], scope: QuizScope): T[] {
  if (scope === 'world') return countries;
  return countries.filter(SCOPE_MEMBERS[scope]);
}
