/**
 * Study-session policy: which cards are asked, in what order, and how a session is built
 * from them.
 */
import { isDue, shuffle, type CardMap, type Question } from '~/features/progress';
import type { CountryRecord } from '~/engines/map/types';
import { applicableFacets, cardId } from './mastery';
import { makeQuestion } from './question-generators';
import { ASKABLE_FACETS, type Catalogue, type FacetCard } from './question-kinds';

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
