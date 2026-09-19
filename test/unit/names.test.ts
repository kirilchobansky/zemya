/**
 * Unit tests for country name matching (app/lib/geography/names.ts), checked against the
 * real, shipped catalogue (public/data/geography/countries.json, via the same catalog
 * reader every route loader uses) — matching has to work on the real 197 countries' real
 * aliases, not a hand-built fixture.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from 'vitest';

import { allCountries, countryBySlug } from '~/lib/geography/catalog.server';
import { matchesCountry, normaliseName } from '~/lib/geography/names';

describe('matchesCountry', () => {
  it('matches every spelling of Côte d\'Ivoire / Ivory Coast', () => {
    const civ = countryBySlug('ivory-coast')!;
    for (const typed of ['cote divoire', 'Côte d\'Ivoire', 'IVORY COAST', 'ivory-coast']) {
      expect(matchesCountry(typed, civ)).toBe(true);
    }
  });

  it('matches the old names still in common use', () => {
    expect(matchesCountry('burma', countryBySlug('myanmar')!)).toBe(true);
    expect(matchesCountry('swaziland', countryBySlug('eswatini')!)).toBe(true);
    expect(matchesCountry('holland', countryBySlug('netherlands')!)).toBe(true);
  });

  it('matches common spellings of the United States but not the bare "us" code', () => {
    const usa = countryBySlug('united-states')!;
    expect(matchesCountry('usa', usa)).toBe(true);
    expect(matchesCountry('united states of america', usa)).toBe(true);
    expect(matchesCountry('United States', usa)).toBe(true);
    expect(matchesCountry('us', usa)).toBe(false);
  });

  it('matches São Tomé and Príncipe typed with no diacritics', () => {
    const stp = countryBySlug('sao-tome-and-principe')!;
    expect(matchesCountry('sao tome and principe', stp)).toBe(true);
  });

  it('a typo does not match — matching is exact after normalisation, not fuzzy', () => {
    const kyrgyzstan = countryBySlug('kyrgyzstan')!;
    expect(matchesCountry('kirgizstan', kyrgyzstan)).toBe(false);
  });

  /** Aliases two countries deliberately share via an `aliases.add` in their YAML — see
   *  build-content.mjs. "Congo" is a correct answer for either Congo. */
  const SHARED_ON_PURPOSE = new Set(['congo']);

  it('no alias of any country matches any other country, except those shared on purpose', () => {
    const countries = allCountries();
    const owner = new Map<string, string>();
    for (const country of countries) {
      for (const alias of country.aliases) {
        const key = normaliseName(alias);
        // A non-Latin-script alias (Armenian, Cyrillic, ...) strips down to nothing —
        // matchesCountry() already refuses to match an empty normalised input, so an
        // empty key here is inert, not a real collision between two such aliases.
        if (!key) continue;
        const existingOwner = owner.get(key);
        if (existingOwner !== undefined && SHARED_ON_PURPOSE.has(key)) continue;
        if (existingOwner !== undefined) {
          expect(existingOwner).toBe(country.iso3);
        } else {
          owner.set(key, country.iso3);
        }
      }
    }
    expect(owner.size).toBeGreaterThan(0);
  });
});

describe('per-country alias edits (aliases: in the YAML)', () => {
  const accepts = (slug: string, typed: string) => matchesCountry(typed, countryBySlug(slug)!);

  it('Thailand no longer accepts "Thai", but still accepts its own names', () => {
    expect(accepts('thailand', 'Thai')).toBe(false);
    expect(accepts('thailand', 'thailand')).toBe(true);
    expect(accepts('thailand', 'Kingdom of Thailand')).toBe(true);
  });

  it('the United Kingdom accepts UK and its full name', () => {
    expect(accepts('united-kingdom', 'UK')).toBe(true);
    expect(accepts('united-kingdom', 'uk')).toBe(true);
    expect(accepts('united-kingdom', 'United Kingdom of Great Britain and Northern Ireland')).toBe(true);
  });

  it('the United States accepts USA and its full name', () => {
    expect(accepts('united-states', 'USA')).toBe(true);
    expect(accepts('united-states', 'United States of America')).toBe(true);
  });

  it('both Congos accept their full names and plain "Congo"; DR Congo also accepts "DR Congo"', () => {
    expect(accepts('dr-congo', 'Democratic Republic of the Congo')).toBe(true);
    expect(accepts('dr-congo', 'DR Congo')).toBe(true);
    expect(accepts('dr-congo', 'Congo')).toBe(true);
    expect(accepts('republic-of-the-congo', 'Republic of the Congo')).toBe(true);
    expect(accepts('republic-of-the-congo', 'Congo')).toBe(true);
  });

  it('the two Congos still do not accept each other\'s distinguishing names', () => {
    expect(accepts('republic-of-the-congo', 'DR Congo')).toBe(false);
    expect(accepts('dr-congo', 'Republic of the Congo')).toBe(false);
  });
});

describe('normaliseName', () => {
  it('is case, diacritic and punctuation insensitive', () => {
    expect(normaliseName('CÔTE D\'IVOIRE')).toBe(normaliseName('cote divoire'));
    expect(normaliseName('ivory-coast')).toBe(normaliseName('Ivory Coast'));
  });
});
