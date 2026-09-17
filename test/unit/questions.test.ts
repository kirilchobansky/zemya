/**
 * Unit tests for question generation (app/lib/geography/questions.ts), checked against the
 * real, shipped catalogue (public/data/geography/countries.json, via the same catalog
 * reader every route loader uses) rather than fixtures — so "every country produces a
 * sane question" is a fact about the real 196, not a hand-built case.
 *
 *   npm run test:unit
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { allCountries, countryBySlug } from '~/lib/geography/catalog.server';
import {
  buildCatalogue,
  KINDS_FOR_FACET,
  questionOfKind,
  type QuestionKind
} from '~/lib/geography/questions';
import { makeRng } from '~/lib/core/questions';

const catalogue = buildCatalogue(allCountries());
const ALL_KINDS = [...new Set(Object.values(KINDS_FOR_FACET).flat())] as QuestionKind[];

describe('determinism', () => {
  it('same seed -> byte-identical question, twice', () => {
    const bulgaria = countryBySlug('bulgaria')!;
    const a = questionOfKind('capital-of', bulgaria, catalogue, makeRng(42));
    const b = questionOfKind('capital-of', bulgaria, catalogue, makeRng(42));
    expect(a).toEqual(b);
  });

  it('a different seed can produce a different option order', () => {
    const bulgaria = countryBySlug('bulgaria')!;
    const a = questionOfKind('capital-of', bulgaria, catalogue, makeRng(1));
    const b = questionOfKind('capital-of', bulgaria, catalogue, makeRng(2));
    // not a hard guarantee for every seed pair, but true often enough that if this ever
    // starts failing it means the RNG stopped being read (e.g. options always alphabetised)
    expect(a?.options).not.toEqual(b?.options);
  });
});

describe('every country, every kind', () => {
  const countries = allCountries();

  for (const kind of ALL_KINDS) {
    it(`${kind}: well-formed whenever it can be built`, () => {
      let built = 0;
      for (const country of countries) {
        const rng = makeRng(hashOf(country.iso3 + kind));
        const question = questionOfKind(kind, country, catalogue, rng);
        if (!question) continue;
        built += 1;

        expect(question.options).toHaveLength(4);
        expect(new Set(question.options).size).toBe(4); // no duplicate option text
        expect(question.answerIndex).toBeGreaterThanOrEqual(0);
        expect(question.answerIndex).toBeLessThan(4);

        const correctValue = question.options[question.answerIndex];
        const distractors = question.options.filter((_, i) => i !== question.answerIndex);
        expect(distractors).not.toContain(correctValue); // no distractor equals the correct value
      }
      // sanity check the test itself isn't vacuously passing over zero countries
      expect(built).toBeGreaterThan(0);
    });
  }
});

describe('not-a-neighbour', () => {
  it('the correct option genuinely does not border; all three distractors do', () => {
    const countries = allCountries();
    let checked = 0;
    for (const country of countries) {
      if (country.borders.length < 3) continue;
      const question = questionOfKind('not-a-neighbour', country, catalogue, makeRng(7));
      if (!question) continue;
      checked += 1;

      const byName = new Map(countries.map(c => [c.name, c]));
      const correctName = question.options[question.answerIndex];
      const correctCountry = byName.get(correctName)!;
      expect(country.borders).not.toContain(correctCountry.iso3);

      const distractorNames = question.options.filter((_, i) => i !== question.answerIndex);
      for (const name of distractorNames) {
        const neighbour = byName.get(name)!;
        expect(country.borders).toContain(neighbour.iso3);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('a country with fewer than 3 neighbours returns null, never a 2-option question', () => {
    const sparse = allCountries().filter(c => c.borders.length < 3);
    expect(sparse.length).toBeGreaterThan(0); // there are real examples in the shipped data
    for (const country of sparse) {
      expect(questionOfKind('not-a-neighbour', country, catalogue, makeRng(3))).toBeNull();
    }
  });
});

describe('Micronesia currency (guards the override in commit 2)', () => {
  it('produces a currency-of question now that its currency is USD, not null', () => {
    const micronesia = countryBySlug('micronesia')!;
    expect(micronesia.currencyCode).toBe('USD');
    const question = questionOfKind('currency-of', micronesia, catalogue, makeRng(9));
    expect(question).not.toBeNull();
    expect(question!.options[question!.answerIndex]).toBe('United States dollar');
  });
});

describe('flag assets', () => {
  it('every country has a flag file on disk for flag-image', () => {
    for (const country of allCountries()) {
      const path = join(process.cwd(), 'public', 'flags', `${country.iso2.toLowerCase()}.svg`);
      expect(existsSync(path), `missing flag file for ${country.iso3} (${path})`).toBe(true);
    }
  });
});

/** A small, deterministic string -> seed hash — so "every country, every kind" above gets a
 *  different but reproducible RNG per (country, kind) pair instead of reusing one seed for
 *  everything (which would only ever exercise one shuffle outcome). */
function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
