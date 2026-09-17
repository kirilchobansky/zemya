/**
 * What "knowing a country" means, and how a country's progress is derived from its cards.
 *
 * This is the geography half of the progress layer: `app/lib/core/` deals in opaque card
 * ids and must never learn what a country is. Everything that knows a country has a
 * capital, or that an island has no land borders, lives here.
 */
import type { CardMap } from '~/lib/core/ProgressProvider';
import { isLearned } from '~/lib/core/scheduler';
import type { CountryRecord } from '~/lib/map/types';

/**
 * A country is not one thing you know. You can know Bulgaria's capital and not its
 * currency, so the unit of scheduling is a (country, facet) pair — one card each.
 */
export const FACETS = [
  'location',
  'capital',
  'flag',
  'currency',
  'language',
  'religion',
  'borders',
  'outline'
] as const;

export type Facet = (typeof FACETS)[number];

export const FACET_LABELS: Record<Facet, string> = {
  location: 'Where it is',
  capital: 'Capital',
  flag: 'Flag',
  currency: 'Currency',
  language: 'Language',
  religion: 'Religion',
  borders: 'Land borders',
  outline: 'Outline'
};

/** The subject prefix. History will write `hist:…` ids into the same store. */
export const SUBJECT = 'geo';

/**
 * `geo:BGR:capital`. ISO3 rather than the slug because a slug is a public URL that could
 * in principle be re-spelled, while ISO3 is an external standard — and progress surviving
 * a rename matters more than the id being readable.
 */
export function cardId(iso3: string, facet: Facet): string {
  return `${SUBJECT}:${iso3}:${facet}`;
}

/** The inverse of cardId() — used where a screen needs to get back from a card id (or a
 *  Question's cardId, which is the same string) to the country it's about. Returns null
 *  for anything that isn't one of ours, rather than throwing on a malformed id. */
export function parseCardId(id: string): { iso3: string; facet: Facet } | null {
  const [subject, iso3, facet] = id.split(':');
  if (subject !== SUBJECT || !iso3 || !FACETS.includes(facet as Facet)) return null;
  return { iso3, facet: facet as Facet };
}

/**
 * A facet only counts when the country actually has the data for it: no borders card for
 * an island, no currency card where the field is null. This set is the denominator for
 * mastery, which is what keeps the bar fair — Vatican City has fewer facets than Brazil,
 * and mastering it should not require answering questions that have no answer.
 *
 * A facet the content marks `disputed` (see content/geography/countries/*.yaml and
 * scripts/build-content.mjs) is excluded here too, not just from the question rotation:
 * quizzing a fact nobody can verify would make mastery require guessing right on
 * something contested, and a country whose only disputed field is, say, religion should
 * still be able to reach 100%.
 */
export function applicableFacets(country: CountryRecord): Facet[] {
  const applies: Record<Facet, boolean> = {
    location: country.latlng.length === 2,
    capital: Boolean(country.capital),
    flag: Boolean(country.emoji),
    currency: Boolean(country.currencyCode),
    language: Boolean(country.language),
    religion: Boolean(country.religion),
    borders: country.borders.length > 0,
    outline: Boolean(country.outlineDescription)
  };
  return FACETS.filter(facet => applies[facet] && !country.disputed[facet]);
}

/**
 * Derived, never stored. Recomputing from the card map means there is no second source of
 * truth to fall out of sync, and an import of someone else's progress is immediately
 * reflected everywhere.
 *
 * - `new`       no card exists for this country at all
 * - `learning`  at least one card exists
 * - `mastered`  every applicable facet has a card that has graduated to FSRS `Review`
 */
export type CountryMastery = 'new' | 'learning' | 'mastered';

export function countryMastery(country: CountryRecord, cards: CardMap): CountryMastery {
  const facets = applicableFacets(country);
  if (!facets.length) return 'new';

  let seen = 0;
  let learned = 0;
  for (const facet of facets) {
    const card = cards.get(cardId(country.iso3, facet));
    if (!card) continue;
    seen += 1;
    if (isLearned(card)) learned += 1;
  }

  if (seen === 0) return 'new';
  return learned === facets.length ? 'mastered' : 'learning';
}

export interface FacetProgress {
  facet: Facet;
  label: string;
  /** No card yet — this facet has never been reviewed. */
  seen: boolean;
  /** Graduated to FSRS `Review`. */
  learned: boolean;
  /** Epoch ms of the next review, or null when never reviewed. */
  due: number | null;
}

/** Per-facet breakdown for the dossier. Applicable facets only. */
export function facetProgress(country: CountryRecord, cards: CardMap): FacetProgress[] {
  return applicableFacets(country).map(facet => {
    const card = cards.get(cardId(country.iso3, facet));
    return {
      facet,
      label: FACET_LABELS[facet],
      seen: Boolean(card),
      learned: Boolean(card && isLearned(card)),
      due: card ? card.due : null
    };
  });
}

export interface MasteryTotals {
  mastered: number;
  learning: number;
  new: number;
  total: number;
}

export function masteryTotals(countries: CountryRecord[], cards: CardMap): MasteryTotals {
  const totals: MasteryTotals = { mastered: 0, learning: 0, new: 0, total: countries.length };
  for (const country of countries) totals[countryMastery(country, cards)] += 1;
  return totals;
}
