/**
 * Distractor and option picking shared by every question generator.
 */
import { sample, shuffle } from '~/features/progress';
import type { CountryRecord } from '~/engines/map/types';
import type { Catalogue } from './question-kinds';

/**
 * A distractor is always a real value from another country, never invented, and deduped
 * by VALUE rather than by country — Vatican City and Italy are both "Roman Catholicism",
 * twenty countries are "Euro", and a distractor equal to the correct answer is a broken
 * question.
 *
 * Preference is same-*subregion*, not the coarse 5-way `region` the map's continent
 * overlay uses — `region` alone would happily put Iceland next to Portugal. Subregion is
 * what turns "Sofia / Bucharest / Belgrade / Skopje" (all Southeast Europe) into a cluster
 * that teaches something, rather than "Sofia / Lima / Hanoi / Oslo".
 *
 * Fewer than 3 distinct values in-subregion widens the pool to every distinct value in the
 * catalogue ("global"); still fewer than 3 there means the question can't be built.
 */
export function pickDistractors(
  country: CountryRecord,
  catalogue: Catalogue,
  valueOf: (c: CountryRecord) => string | null,
  correctValue: string,
  rng: () => number,
  /** Rejects a candidate value outright, before dedup/subregion bucketing. Defaults to
   *  plain equality; religion-of passes something stronger — see religionsClash(). */
  clashesWithCorrect: (candidate: string) => boolean = candidate => candidate === correctValue
): string[] | null {
  const isSubregional = new Map<string, boolean>();
  for (const c of catalogue.countries) {
    if (c.iso3 === country.iso3) continue;
    const value = valueOf(c);
    if (!value || clashesWithCorrect(value)) continue;
    const already = isSubregional.get(value) ?? false;
    isSubregional.set(value, already || c.subregion === country.subregion);
  }

  const subregional = [...isSubregional.entries()].filter(([, yes]) => yes).map(([v]) => v);
  const global = [...isSubregional.keys()];
  const pool = subregional.length >= 3 ? subregional : global;
  if (pool.length < 3) return null;
  return sample(pool, 3, rng);
}

/** Build a 4-option question from a correct value and its distractors, in random order. */
export function withOptions(
  correctValue: string,
  distractors: string[],
  rng: () => number
): { options: string[]; answerIndex: number } {
  const options = shuffle([correctValue, ...distractors], rng);
  return { options, answerIndex: options.indexOf(correctValue) };
}

/* ------------------------------------------------------------------------- neighbours */

/**
 * A plausible non-neighbour for "which of these does NOT border X": same subregion as the
 * target ideally, and ideally one that borders one of the three real neighbours already
 * chosen — that's what makes Greece a good foil for Bulgaria's neighbours (it borders
 * Turkey) rather than some unrelated country that happens to share a subregion label.
 */
export function pickNonNeighbour(
  country: CountryRecord,
  neighbours: CountryRecord[],
  catalogue: Catalogue,
  rng: () => number
): CountryRecord | null {
  const excluded = new Set([country.iso3, ...country.borders]);
  const neighbourIso3 = new Set(neighbours.map(n => n.iso3));

  const candidates = catalogue.countries.filter(c => !excluded.has(c.iso3));
  const isPlausible = (c: CountryRecord) => c.borders.some(b => neighbourIso3.has(b));
  const sameSubregion = (c: CountryRecord) => c.subregion === country.subregion;
  const sameRegion = (c: CountryRecord) => c.region === country.region;

  const tiers = [
    candidates.filter(c => sameSubregion(c) && isPlausible(c)),
    candidates.filter(sameSubregion),
    candidates.filter(c => sameRegion(c) && isPlausible(c)),
    candidates.filter(sameRegion),
    candidates
  ];

  for (const tier of tiers) {
    if (tier.length) return sample(tier, 1, rng)[0];
  }
  return null;
}
