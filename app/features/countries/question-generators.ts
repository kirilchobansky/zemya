/**
 * The nine question generators and the two entry points that pick one (makeQuestion for
 * production, questionOfKind for tests). Every generator is pure: same country, same
 * catalogue, same RNG state in, same Question out.
 */
import { sample, shuffle, type Question } from '~/features/progress';
import type { CountryRecord } from '~/engines/map/types';
import { pickDistractors, pickNonNeighbour, withOptions } from './distractors';
import { cardId } from './mastery';
import { FACET_FOR_KIND, KINDS_FOR_FACET, type Catalogue, type FacetCard, type QuestionKind } from './question-kinds';
import { religionsClash } from './religion';

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

/** A country can have several official languages and the data has no "primary" one (`language`
 *  is just the alphabetically first), so the right answer is ANY of them, picked at random;
 *  the distractors are languages none of which the country has, and the prompt says "an" when
 *  there are several. The full list is shown after answering (`note`). */
function languageOf(country: CountryRecord, catalogue: Catalogue, rng: () => number, id: string): Question | null {
  if (!country.languages.length) return null;
  const correct = country.languages[Math.floor(rng() * country.languages.length)];
  const distractors = pickDistractors(
    country, catalogue, c => c.language, correct, rng,
    candidate => country.languages.includes(candidate)
  );
  if (!distractors) return null;
  const { options, answerIndex } = withOptions(correct, distractors, rng);
  const several = country.languages.length > 1;
  return {
    id: `${id}:language-of`,
    cardId: id,
    kind: 'language-of',
    prompt: several
      ? `Which of these is an official language of ${country.name}?`
      : `What is the official language of ${country.name}?`,
    options,
    answerIndex,
    hook: country.hook,
    note: several ? `Official languages: ${country.languages.join(', ')}.` : undefined
  };
}

function religionOf(country: CountryRecord, catalogue: Catalogue, rng: () => number, id: string): Question | null {
  if (!country.religion) return null;
  const distractors = pickDistractors(
    country, catalogue, c => c.religion, country.religion, rng,
    candidate => religionsClash(country.religion, candidate)
  );
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
  const facet = FACET_FOR_KIND[kind];
  if (country.disputed[facet]) return null;
  return GENERATORS[kind](country, catalogue, rng, cardId(country.iso3, facet));
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
  // A disputed facet is never quizzed — see mastery.ts's applicableFacets(), which is
  // the reason this branch is normally unreachable (the session builder won't offer a
  // disputed facet as a candidate in the first place); kept here too so makeQuestion()
  // gives the same answer even when called directly, e.g. from a test.
  if (country.disputed[card.facet]) return null;
  for (const kind of shuffle(KINDS_FOR_FACET[card.facet], rng)) {
    const question = GENERATORS[kind](country, catalogue, rng, card.id);
    if (question) return question;
  }
  return null;
}
