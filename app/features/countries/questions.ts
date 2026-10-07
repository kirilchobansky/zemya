/**
 * Question generation: nine kinds of multiple-choice question, built from the same
 * country catalogue the map and the dossier use. Every generator is pure — same country,
 * same catalogue, same RNG state in, same Question out — which is what lets
 * app/features/countries/questions.test.ts assert byte-identical output for a fixed seed.
 *
 * `location` is deliberately not covered: it needs map clicks, which is the next piece of
 * work. ASKABLE_FACETS filters the rotation so turning it on later is a one-line change —
 * applicableFacets() itself is untouched, so the mastery denominator stays honest.
 */
import { makeRng } from '~/features/progress';

export { makeRng };
export { ASKABLE_FACETS, KINDS_FOR_FACET, buildCatalogue } from './question-kinds';
export type { Catalogue, FacetCard, QuestionKind } from './question-kinds';
export { BROADER, religionChain, religionsClash } from './religion';
export { makeQuestion, questionOfKind } from './question-generators';
export { generateSession } from './session';
