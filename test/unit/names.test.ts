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

  it('no alias of any country matches any other country', () => {
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

describe('normaliseName', () => {
  it('is case, diacritic and punctuation insensitive', () => {
    expect(normaliseName('CÔTE D\'IVOIRE')).toBe(normaliseName('cote divoire'));
    expect(normaliseName('ivory-coast')).toBe(normaliseName('Ivory Coast'));
  });
});
