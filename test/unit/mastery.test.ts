/**
 * Unit tests for the geography mastery derivation (app/lib/geography/mastery.ts).
 *
 *   npm run test:unit
 */
import { describe, expect, it } from 'vitest';

import { countryBySlug } from '~/lib/geography/catalog.server';
import { applicableFacets, cardId, countryMastery, FACETS } from '~/lib/geography/mastery';
import type { ProgressCard } from '~/lib/core/scheduler';

/** A fixture card that has graduated to Review — the only state isLearned() reads as true.
 *  countryMastery() is tested here as a pure function of the card map, independent of
 *  whether a card actually reached Review through FSRS — that path is covered separately
 *  in test/unit/scheduler.test.ts. */
function reviewCard(id: string): ProgressCard {
  return {
    id,
    due: Date.now() + 86_400_000,
    stability: 10,
    difficulty: 5,
    scheduledDays: 1,
    learningSteps: 0,
    reps: 3,
    lapses: 0,
    state: 'review',
    lastReview: Date.now()
  };
}

describe('countryMastery', () => {
  const country = countryBySlug('bulgaria')!;
  const facets = applicableFacets(country);

  it('is "mastered" only once every applicable facet has graduated to Review', () => {
    const full = new Map(facets.map(f => [cardId(country.iso3, f), reviewCard(cardId(country.iso3, f))]));
    expect(countryMastery(country, full)).toBe('mastered');

    // pull one facet back out of Review — no longer every applicable facet qualifies
    const partial = new Map(full);
    partial.delete(cardId(country.iso3, facets[0]));
    expect(countryMastery(country, partial)).toBe('learning');

    expect(countryMastery(country, new Map())).toBe('new');
  });
});

describe('applicableFacets — the per-country denominator', () => {
  /**
   * Checked against the real, shipped content (public/data/geography/countries.json, via
   * the same catalog reader every route loader uses) rather than fixtures — so this proves
   * the denominator actually varies for real users on real data, not just a hand-built case.
   */
  const switzerland = countryBySlug('switzerland')!; // landlocked, every field populated
  const japan = countryBySlug('japan')!; // island, no land borders
  const vatican = countryBySlug('vatican-city')!; // requested third example — see below
  const micronesia = countryBySlug('micronesia')!; // island AND a null currencyCode

  it('a landlocked country with complete data applies every facet', () => {
    expect(applicableFacets(switzerland)).toEqual(FACETS); // all 8 — nothing excludes any
  });

  it('an island nation with no land borders excludes the borders facet', () => {
    expect(japan.borders).toHaveLength(0);
    const facets = applicableFacets(japan);
    expect(facets).not.toContain('borders');
    expect(facets).toHaveLength(FACETS.length - 1);
  });

  /**
   * Vatican City, as requested, does NOT give a third distinct value: in the shipped
   * dataset it borders Italy (borders.length === 1) and every other field is populated, so
   * its denominator is 8 — tied with the landlocked example, not different from it. Real
   * finding, documented rather than worked around.
   */
  it('Vatican City applies every facet too — it ties with the landlocked example', () => {
    expect(vatican.borders.length).toBeGreaterThan(0); // it borders Italy
    expect(applicableFacets(vatican)).toEqual(FACETS);
  });

  /**
   * Micronesia is the real, shipped country used in place of Vatican City for the "three
   * denominators differ" assertion below: an island with no land borders (like Japan) AND
   * a null currencyCode, excluding a second facet.
   */
  it('a country missing more than one field has a smaller denominator still', () => {
    expect(micronesia.borders).toHaveLength(0);
    expect(micronesia.currencyCode).toBeNull();
    const facets = applicableFacets(micronesia);
    expect(facets).not.toContain('borders');
    expect(facets).not.toContain('currency');
    expect(facets).toHaveLength(FACETS.length - 2);
  });

  it('the denominator varies: landlocked, island, and a sparser micro-state all differ', () => {
    const denominators = {
      switzerland: applicableFacets(switzerland).length,
      japan: applicableFacets(japan).length,
      micronesia: applicableFacets(micronesia).length
    };
    console.log('denominators (landlocked / island / sparser micro-state):', denominators);

    const values = Object.values(denominators);
    expect(new Set(values).size).toBe(values.length); // pairwise distinct
  });
});
