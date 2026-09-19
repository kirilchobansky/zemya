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
import { matchesCapital, matchesCountry, normaliseName } from '~/lib/geography/names';

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

describe('matchesCapital', () => {
  /** Every country whose capital `typed` names, by ISO3 — the "does this resolve to exactly
   *  one country" question in one call. */
  const ownersOf = (typed: string) =>
    allCountries().filter(c => matchesCapital(typed, c)).map(c => c.iso3);

  it('every capital matches its own authored name, typed exactly and lowercased', () => {
    for (const country of allCountries()) {
      expect(country.capital, country.iso3).toBeTruthy();
      expect(matchesCapital(country.capital!, country), country.iso3).toBe(true);
      expect(matchesCapital(country.capital!.toLowerCase(), country), country.iso3).toBe(true);
    }
  });

  it('normalisation alone handles diacritics, apostrophes and punctuation', () => {
    expect(ownersOf('Bogota')).toEqual(['COL']);
    expect(ownersOf('sao tome')).toEqual(['STP']);
    expect(ownersOf("N'Djamena")).toEqual(['TCD']);
    expect(ownersOf('ndjamena')).toEqual(['TCD']);
    expect(ownersOf("Nuku'alofa")).toEqual(['TON']);
    expect(ownersOf('nukualofa')).toEqual(['TON']);
    expect(ownersOf('Chisinau')).toEqual(['MDA']);
    expect(ownersOf('Sanaa')).toEqual(['YEM']);
    expect(ownersOf("Sana'a")).toEqual(['YEM']);
    expect(ownersOf('Ulan-Bator')).toEqual(['MNG']);
  });

  /** The ones a player will actually type — alternates, older names, spellings that differ
   *  by more than punctuation. [typed, iso3] */
  const ALIASES: [string, string][] = [
    ['Kyiv', 'UKR'], ['Kiev', 'UKR'],
    ['Astana', 'KAZ'], ['Nur-Sultan', 'KAZ'], ['Nur Sultan', 'KAZ'],
    ['Nay Pyi Taw', 'MMR'], ['Naypyidaw', 'MMR'], ['Naypyitaw', 'MMR'],
    ['Washington', 'USA'], ['Washington DC', 'USA'], ['Washington D.C.', 'USA'],
    ['Bern', 'CHE'], ['Berne', 'CHE'],
    ['Ulaanbaatar', 'MNG'], ['Ulan Bator', 'MNG'],
    ['Beijing', 'CHN'], ['Peking', 'CHN'],
    ['Chisinau', 'MDA'], ['Kishinev', 'MDA'],
    ['Ashgabat', 'TKM'], ['Ashkhabad', 'TKM'],
    ['Dhaka', 'BGD'], ['Dacca', 'BGD'],
    ['Tehran', 'IRN'], ['Teheran', 'IRN'],
    ['Brussels', 'BEL'], ['Bruxelles', 'BEL'], ['Brussel', 'BEL'],
    ['New Delhi', 'IND'], ['Delhi', 'IND'],
    ['Vatican City', 'VAT'], ['Vatican', 'VAT'],
    ['Pretoria', 'ZAF'], ['Bloemfontein', 'ZAF'], ['Cape Town', 'ZAF'],
    ['San Marino', 'SMR'], ['Tarawa', 'KIR'], ['Saint George\'s', 'GRD'], ['St. George\'s', 'GRD'],
    ['København', 'DNK'], ['Kobenhavn', 'DNK'], ['Copenhagen', 'DNK']
  ];
  it.each(ALIASES)('%s names the capital of exactly one country: %s', (typed, iso3) => {
    expect(ownersOf(typed)).toEqual([iso3]);
  });

  it('South Africa is the only country that accepts three capitals, through the ordinary alias list', () => {
    const zaf = allCountries().find(c => c.iso3 === 'ZAF')!;
    expect(zaf.capital).toBe('Pretoria');
    expect(zaf.capitalAliases).toEqual(expect.arrayContaining(['Pretoria', 'Bloemfontein', 'Cape Town']));
    // no other country lists another official capital of its own as an alternate
    for (const country of allCountries()) {
      if (country.iso3 === 'ZAF') continue;
      expect(country.capitalAliases).not.toContain('Bloemfontein');
      expect(country.capitalAliases).not.toContain('Cape Town');
    }
  });

  it('no accepted capital name resolves to two countries', () => {
    const seen = new Map<string, string>();
    for (const country of allCountries()) {
      for (const alias of country.capitalAliases) {
        const key = normaliseName(alias);
        const prior = seen.get(key);
        expect(prior === undefined || prior === country.iso3, `"${alias}" claimed by ${prior} and ${country.iso3}`).toBe(true);
        seen.set(key, country.iso3);
      }
    }
  });

  it('a typo does not match — matching is exact after normalisation, not fuzzy', () => {
    for (const typed of ['Bucharst', 'Viena', 'Sofa', 'Buenos Aires ', 'Washingtn', 'Kyv', '']) {
      const owners = ownersOf(typed);
      // "Buenos Aires " (trailing space) DOES match after normalisation; the rest must not
      if (typed.trim() === 'Buenos Aires') expect(owners).toEqual(['ARG']);
      else expect(owners, typed).toEqual([]);
    }
  });

  it('a country name is not its capital, unless the two really share one', () => {
    expect(ownersOf('France')).toEqual([]);
    expect(ownersOf('Bulgaria')).toEqual([]);
    expect(ownersOf('Luxembourg')).toEqual(['LUX']);
  });
});
