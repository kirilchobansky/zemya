/**
 * Question generation: nine kinds of multiple-choice question, built from the same
 * country catalogue the map and the dossier use. Every generator is pure — same country,
 * same catalogue, same RNG state in, same Question out — which is what lets
 * test/unit/questions.test.ts assert byte-identical output for a fixed seed.
 *
 * `location` is deliberately not covered: it needs map clicks, which is the next piece of
 * work. ASKABLE_FACETS filters the rotation so turning it on later is a one-line change —
 * applicableFacets() itself is untouched, so the mastery denominator stays honest.
 */
import { makeRng, sample, shuffle, type Question } from '~/lib/core/questions';
import type { CardMap } from '~/lib/core/ProgressProvider';
import { isDue } from '~/lib/core/scheduler';
import { applicableFacets, cardId, FACETS, type Facet } from './mastery';
import type { CountryRecord } from '~/lib/map/types';

export { makeRng };

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

const FACET_FOR_KIND = Object.fromEntries(
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

/* --------------------------------------------------------------- distractor picking */

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
function pickDistractors(
  country: CountryRecord,
  catalogue: Catalogue,
  valueOf: (c: CountryRecord) => string | null,
  correctValue: string,
  rng: () => number
): string[] | null {
  const isSubregional = new Map<string, boolean>();
  for (const c of catalogue.countries) {
    if (c.iso3 === country.iso3) continue;
    const value = valueOf(c);
    if (!value || value === correctValue) continue;
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
function withOptions(
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
function pickNonNeighbour(
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

/* ------------------------------------------------------------------------- generators */

type Generator = (
  country: CountryRecord,
  catalogue: Catalogue,
  rng: () => number,
  cardId: string
) => Question | null;

function capitalOf(country: CountryRecord, catalogue: Catalogue, rng: () => number, id: string): Question | null {
  if (!country.capital) return null;
  const distractors = pickDistractors(country, catalogue, c => c.capital, country.capital, rng);
  if (!distractors) return null;
  const { options, answerIndex } = withOptions(country.capital, distractors, rng);
  return {
    id: `${id}:capital-of`,
    cardId: id,
    kind: 'capital-of',
    prompt: `What is the capital of ${country.name}?`,
    options,
    answerIndex,
    hook: country.hook
  };
}

function countryOfCapital(country: CountryRecord, catalogue: Catalogue, rng: () => number, id: string): Question | null {
  if (!country.capital) return null;
  const distractors = pickDistractors(country, catalogue, c => c.name, country.name, rng);
  if (!distractors) return null;
  const { options, answerIndex } = withOptions(country.name, distractors, rng);
  return {
    id: `${id}:country-of-capital`,
    cardId: id,
    kind: 'country-of-capital',
    prompt: `${country.capital} is the capital of which country?`,
    options,
    answerIndex,
    hook: country.hook
  };
}

function currencyOf(country: CountryRecord, catalogue: Catalogue, rng: () => number, id: string): Question | null {
  if (!country.currencyName) return null;
  const distractors = pickDistractors(country, catalogue, c => c.currencyName, country.currencyName, rng);
  if (!distractors) return null;
  const { options, answerIndex } = withOptions(country.currencyName, distractors, rng);
  return {
    id: `${id}:currency-of`,
    cardId: id,
    kind: 'currency-of',
    prompt: `What money do you spend in ${country.name}?`,
    options,
    answerIndex,
    hook: country.hook
  };
}

function languageOf(country: CountryRecord, catalogue: Catalogue, rng: () => number, id: string): Question | null {
  if (!country.language) return null;
  const distractors = pickDistractors(country, catalogue, c => c.language, country.language, rng);
  if (!distractors) return null;
  const { options, answerIndex } = withOptions(country.language, distractors, rng);
  return {
    id: `${id}:language-of`,
    cardId: id,
    kind: 'language-of',
    prompt: `What is the official language of ${country.name}?`,
    options,
    answerIndex,
    hook: country.hook
  };
}

function religionOf(country: CountryRecord, catalogue: Catalogue, rng: () => number, id: string): Question | null {
  if (!country.religion) return null;
  const distractors = pickDistractors(country, catalogue, c => c.religion, country.religion, rng);
  if (!distractors) return null;
  const { options, answerIndex } = withOptions(country.religion, distractors, rng);
  return {
    id: `${id}:religion-of`,
    cardId: id,
    kind: 'religion-of',
    prompt: `What is the predominant religion in ${country.name}?`,
    options,
    answerIndex,
    hook: country.hook
  };
}

function flagImage(country: CountryRecord, catalogue: Catalogue, rng: () => number, id: string): Question | null {
  const distractors = pickDistractors(country, catalogue, c => c.name, country.name, rng);
  if (!distractors) return null;
  const { options, answerIndex } = withOptions(country.name, distractors, rng);
  return {
    id: `${id}:flag-image`,
    cardId: id,
    kind: 'flag-image',
    prompt: 'Which country is this?',
    promptFlag: country.iso2,
    options,
    answerIndex,
    hook: country.hook
  };
}

function flagFromDescription(country: CountryRecord, catalogue: Catalogue, rng: () => number, id: string): Question | null {
  if (!country.flagDescription) return null;
  const distractors = pickDistractors(country, catalogue, c => c.name, country.name, rng);
  if (!distractors) return null;
  const { options, answerIndex } = withOptions(country.name, distractors, rng);
  return {
    id: `${id}:flag-from-description`,
    cardId: id,
    kind: 'flag-from-description',
    prompt: country.flagDescription,
    options,
    answerIndex,
    hook: country.hook
  };
}

function outlineFromDescription(country: CountryRecord, catalogue: Catalogue, rng: () => number, id: string): Question | null {
  if (!country.outlineDescription) return null;
  const distractors = pickDistractors(country, catalogue, c => c.name, country.name, rng);
  if (!distractors) return null;
  const { options, answerIndex } = withOptions(country.name, distractors, rng);
  return {
    id: `${id}:outline-from-description`,
    cardId: id,
    kind: 'outline-from-description',
    prompt: country.outlineDescription,
    options,
    answerIndex,
    hook: country.hook
  };
}

function notANeighbour(country: CountryRecord, catalogue: Catalogue, rng: () => number, id: string): Question | null {
  const allNeighbours = country.borders
    .map(iso3 => catalogue.byIso3.get(iso3))
    .filter((c): c is CountryRecord => Boolean(c));
  if (allNeighbours.length < 3) return null;

  const chosen = sample(allNeighbours, 3, rng);
  const foil = pickNonNeighbour(country, chosen, catalogue, rng);
  if (!foil) return null;

  const { options, answerIndex } = withOptions(
    foil.name,
    chosen.map(c => c.name),
    rng
  );
  return {
    id: `${id}:not-a-neighbour`,
    cardId: id,
    kind: 'not-a-neighbour',
    prompt: `Which of these does NOT border ${country.name}?`,
    options,
    answerIndex,
    hook: country.hook
  };
}

const GENERATORS: Record<QuestionKind, Generator> = {
  'capital-of': capitalOf,
  'country-of-capital': countryOfCapital,
  'currency-of': currencyOf,
  'language-of': languageOf,
  'religion-of': religionOf,
  'flag-image': flagImage,
  'flag-from-description': flagFromDescription,
  'outline-from-description': outlineFromDescription,
  'not-a-neighbour': notANeighbour
};

/** Test- and tooling-friendly entry point: build one specific kind directly, without going
 *  through a facet's random pick. Production code should use makeQuestion() instead. */
export function questionOfKind(
  kind: QuestionKind,
  country: CountryRecord,
  catalogue: Catalogue,
  rng: () => number
): Question | null {
  return GENERATORS[kind](country, catalogue, rng, cardId(country.iso3, FACET_FOR_KIND[kind]));
}

/**
 * The production entry point. Resolves the card's country, shuffles the kinds available
 * for its facet (so `flag` and `capital` cards pick a kind at random), and returns the
 * first one that can actually be built — a country with only 2 land neighbours never
 * produces a `not-a-neighbour` question, for instance, and that's fine: null is what lets
 * the session builder move on to the next card instead of crashing.
 */
export function makeQuestion(card: FacetCard, catalogue: Catalogue, rng: () => number): Question | null {
  const country = catalogue.byIso3.get(card.iso3);
  if (!country) return null;
  for (const kind of shuffle(KINDS_FOR_FACET[card.facet], rng)) {
    const question = GENERATORS[kind](country, catalogue, rng, card.id);
    if (question) return question;
  }
  return null;
}

/* --------------------------------------------------------------------- session policy */

/**
 * Every (country, askable facet) pair, split into due cards (oldest due first) and new
 * cards (countries with above-median population first, so a beginner meets Brazil before
 * Tuvalu) — the priority order buildSession() draws from.
 */
function orderedCandidates(countries: CountryRecord[], cards: CardMap, now: number, rng: () => number): FacetCard[] {
  const due: { card: FacetCard; due: number }[] = [];
  const fresh: FacetCard[] = [];

  for (const country of countries) {
    for (const facet of applicableFacets(country)) {
      if (!ASKABLE_FACETS.includes(facet)) continue;
      const id = cardId(country.iso3, facet);
      const existing = cards.get(id);
      const card: FacetCard = { id, iso3: country.iso3, facet };
      if (existing) {
        if (isDue(existing, now)) due.push({ card, due: existing.due });
      } else {
        fresh.push(card);
      }
    }
  }

  due.sort((a, b) => a.due - b.due);

  const byIso3 = new Map(countries.map(c => [c.iso3, c]));
  const sortedPopulations = countries.map(c => c.population).slice().sort((a, b) => a - b);
  const median = sortedPopulations[Math.floor(sortedPopulations.length / 2)] ?? 0;
  const above = fresh.filter(c => byIso3.get(c.iso3)!.population >= median);
  const below = fresh.filter(c => byIso3.get(c.iso3)!.population < median);

  return [...due.map(d => d.card), ...shuffle(above, rng), ...shuffle(below, rng)];
}

/**
 * Build one study session: up to `size` questions, due cards first, never two about the
 * same country back to back. Shorter than `size` only when the candidate pool itself runs
 * out — nothing is due, no new cards remain, or (rarely) every remaining candidate keeps
 * failing to produce a question (see makeQuestion's null case).
 */
export function generateSession(
  countries: CountryRecord[],
  cards: CardMap,
  catalogue: Catalogue,
  rng: () => number,
  now: number = Date.now(),
  size = 12
): Question[] {
  const pool = orderedCandidates(countries, cards, now, rng);
  const questions: Question[] = [];
  let lastIso3: string | null = null;

  while (questions.length < size && pool.length) {
    const index = pool.findIndex(c => c.iso3 !== lastIso3);
    if (index === -1) break; // everything left would repeat the last country — stop rather than do that
    const [card] = pool.splice(index, 1);
    const question = makeQuestion(card, catalogue, rng);
    if (question) {
      questions.push(question);
      lastIso3 = card.iso3;
    }
  }

  return questions;
}
