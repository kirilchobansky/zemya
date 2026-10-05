/**
 * "Name all countries": the matcher (names.ts's matchCountryName) over the real catalogue, and
 * the continent grouping. Pure logic — no browser.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from 'vitest';

import { allCountries } from '~/lib/geography/catalog.server';
import { matchCountryName, prepareCountryNames } from '~/lib/geography/names';
import { continentOf, poolForQuiz, QUIZ_SCOPES } from '~/lib/geography/scopes';

const countries = allCountries();
const prepared = prepareCountryNames(countries);
const none: ReadonlySet<string> = new Set();
const nameOf = (m: { index: number } | null) => (m ? countries[m.index].name : null);

describe('matchCountryName', () => {
  it('matches an English name, case and punctuation aside', () => {
    expect(nameOf(matchCountryName('france', prepared, none))).toBe('France');
    expect(nameOf(matchCountryName('  Côte d’Ivoire ', prepared, none))).toBe(countries.find(c => c.iso3 === 'CIV')!.name);
  });

  it('matches Bulgarian names and Latin letters typed for them', () => {
    expect(nameOf(matchCountryName('България', prepared, none))).toBe('Bulgaria');
    expect(nameOf(matchCountryName('bulgaria', prepared, none))).toBe('Bulgaria');
    expect(nameOf(matchCountryName('Франция', prepared, none))).toBe('France');
    expect(nameOf(matchCountryName('frantsiya', prepared, none))).toBe('France');
  });

  it('accepts an exact match at once unless a longer unnamed name starts with it', () => {
    expect(matchCountryName('france', prepared, none)?.instant).toBe(true);
    expect(nameOf(matchCountryName('niger', prepared, none))).toBe('Niger');
    expect(matchCountryName('niger', prepared, none)?.instant).toBe(false); // Nigeria is still open
    const nigeria = countries.find(c => c.name === 'Nigeria')!.iso3;
    expect(matchCountryName('niger', prepared, new Set([nigeria]))?.instant).toBe(true);
  });

  it('waits (not instant) for every exact name that starts a longer unnamed one, found from the list, and takes it once the longer is named', () => {
    const pairs: [number, number][] = []; // [exact country, longer country it prefixes]
    for (let i = 0; i < prepared.length; i++) {
      for (let j = 0; j < prepared.length; j++) {
        if (i === j) continue;
        for (const form of prepared[i].forms) {
          if (/[а-я]/.test(form)) continue;
          if (prepared[j].forms.some(f => f.length > form.length && f.startsWith(form)) && !prepared[i].forms.some(f => f.length > form.length && f.startsWith(form))) pairs.push([i, j]);
        }
      }
    }
    expect(pairs.length).toBeGreaterThan(5);
    const names = (k: number) => countries[pairs[k][0]].name;
    expect(pairs.some((_, k) => names(k) === 'Niger')).toBe(true);
    expect(pairs.some((_, k) => names(k) === 'Dominica')).toBe(true);
    for (const [i, j] of pairs) {
      for (const form of prepared[i].forms.filter(f => !/[а-я]/.test(f))) {
        if (!prepared[j].forms.some(f => f.length > form.length && f.startsWith(form))) continue;
        const open = matchCountryName(form, prepared, none);
        if (!open || open.index !== i) continue; // a form that names someone else is that country's business
        expect(open.instant, `${form} while ${countries[j].name} is open`).toBe(false);
        const others = prepared.filter((p, k) => k !== i && p.forms.some(f => f.length > form.length && f.startsWith(form))).map(p => p.iso3);
        expect(matchCountryName(form, prepared, new Set(others))?.instant, `${form} once ${others.length} longer named`).toBe(true);
      }
    }
  });

  it('accepts Belize, Laos, Tunisia and Suriname, and not Beliz, Lao, Tunis or Surinam (transliteration or typo)', () => {
    for (const [good, bad, cyr] of [['Belize', 'Beliz', 'Белиз'], ['Laos', 'Lao', 'Лаос'], ['Tunisia', 'Tunis', 'Тунис'], ['Suriname', 'Surinam', 'Суринам']]) {
      expect(nameOf(matchCountryName(good, prepared, none)), good).toBe(good);
      expect(nameOf(matchCountryName(cyr, prepared, none)), cyr).toBe(good);
      expect(matchCountryName(bad, prepared, none), bad).toBeNull();
      expect(matchCountryName(bad.toUpperCase(), prepared, none), bad.toUpperCase()).toBeNull();
    }
  });

  it('allows one typo for names of 6+ letters, never instantly', () => {
    const m = matchCountryName('germani', prepared, none);
    expect(nameOf(m)).toBe('Germany');
    expect(m).toMatchObject({ typo: true, instant: false });
    expect(nameOf(matchCountryName('Fraance', prepared, none))).toBe('France'); // 6+ letters: France is 6
    expect(matchCountryName('Chda', prepared, none)).toBeNull(); // Chad is 4 letters: no typo allowance
    expect(matchCountryName('Frnace', prepared, none)).toBeNull(); // two edits
  });

  it('flags a repeat as already named', () => {
    const france = countries.find(c => c.name === 'France')!.iso3;
    expect(matchCountryName('france', prepared, new Set([france]))).toMatchObject({ already: true });
    expect(matchCountryName('france', prepared, none)).toMatchObject({ already: false });
  });

  it('never accepts a spelling two countries share, and never guesses', () => {
    const owners = new Map<string, number>();
    for (const p of prepared) for (const f of p.forms) owners.set(f, (owners.get(f) ?? 0) + 1);
    expect([...owners.values()].every(n => n === 1)).toBe(true);
    expect(matchCountryName('', prepared, none)).toBeNull();
    expect(matchCountryName('atlantis', prepared, none)).toBeNull();
  });

  it('names every country by its own name (or a shorter, unambiguous form)', () => {
    const lost = countries.filter(c => nameOf(matchCountryName(c.name, prepared, none)) !== c.name).map(c => c.name);
    expect(lost).toEqual([]);
  });
});

describe('name-all pools', () => {
  it('uses the geography pools: world is every country, continents partition it', () => {
    expect(poolForQuiz(countries, 'name-all', 'world')).toHaveLength(countries.length);
    const sum = QUIZ_SCOPES.filter(s => s !== 'world').reduce((n, s) => n + poolForQuiz(countries, 'name-all', s).length, 0);
    expect(sum).toBe(countries.length);
    for (const c of countries) expect(poolForQuiz([c], 'name-all', continentOf(c))).toHaveLength(1);
  });
});
