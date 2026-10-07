/**
 * The nine question kinds, which facet each can be asked for, and the catalogue the
 * generators read from. Pure data and types; no generation here.
 */
import type { CountryRecord } from '~/engines/map/types';
import { FACETS, type Facet } from './mastery';

export const ASKABLE_FACETS: Facet[] = FACETS.filter(f => f !== 'location');

export type QuestionKind =
  | 'capital-of'
  | 'country-of-capital'
  | 'currency-of'
  | 'language-of'
  | 'religion-of'
  | 'flag-image'
  | 'flag-from-description'
  | 'outline-from-description'
  | 'not-a-neighbour';

/** Which kinds a facet's card can be asked as. `flag` and `capital` each offer two —
 *  makeQuestion() picks between them at random per card. */
export const KINDS_FOR_FACET: Record<Facet, QuestionKind[]> = {
  location: [],
  capital: ['capital-of', 'country-of-capital'],
  flag: ['flag-image', 'flag-from-description'],
  currency: ['currency-of'],
  language: ['language-of'],
  religion: ['religion-of'],
  borders: ['not-a-neighbour'],
  outline: ['outline-from-description']
};

export const FACET_FOR_KIND = Object.fromEntries(
  (Object.entries(KINDS_FOR_FACET) as [Facet, QuestionKind[]][]).flatMap(([facet, kinds]) =>
    kinds.map(kind => [kind, facet] as const)
  )
) as Record<QuestionKind, Facet>;

/** A card identified well enough to generate a question from — the subset of
 *  ProgressCard's identity that questions.ts actually needs. */
export interface FacetCard {
  id: string;
  iso3: string;
  facet: Facet;
}

export interface Catalogue {
  countries: CountryRecord[];
  byIso3: Map<string, CountryRecord>;
}

export function buildCatalogue(countries: CountryRecord[]): Catalogue {
  return { countries, byIso3: new Map(countries.map(c => [c.iso3, c])) };
}
