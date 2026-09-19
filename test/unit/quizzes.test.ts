/**
 * Unit tests for the quiz catalogue's pure logic (app/lib/geography/quizzes.ts) and the
 * quiz-mode fill/stroke functions (app/lib/geography/overlays.ts), checked against the
 * real, shipped catalogue.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from 'vitest';

import { allCountries, countryBySlug } from '~/lib/geography/catalog.server';
import { quizDefinition, topByPopulation } from '~/lib/geography/quizzes';
import { isQuizScope, isQuizSize, poolForScope, QUIZ_SCOPES, QUIZ_SIZES, sizesForPool } from '~/lib/geography/scopes';
import { quizFillFor, quizStrokeFor, MASTERY_COLOURS, SELECTED, NEIGHBOUR, LAND } from '~/lib/geography/overlays';
import type { Feature } from '~/lib/map/types';

describe('isQuizSize', () => {
  it('accepts every literal in QUIZ_SIZES', () => {
    for (const size of QUIZ_SIZES) expect(isQuizSize(size)).toBe(true);
  });

  it('rejects anything else', () => {
    for (const bad of ['0', '20 ', 'All', '', '19', 'twenty']) expect(isQuizSize(bad)).toBe(false);
  });
});

describe('sizesForPool — the ladder adapts to the pool', () => {
  it('a pool of 14 (Oceania) yields exactly [10, All]', () => {
    expect(sizesForPool(14)).toEqual(['10', 'all']);
  });

  it('a pool of 197 (World) yields exactly [20, 30, 50, 90, 120, All]', () => {
    expect(sizesForPool(197)).toEqual(['20', '30', '50', '90', '120', 'all']);
  });

  it('only offers a rung strictly smaller than the pool, and always offers All', () => {
    expect(sizesForPool(10)).toEqual(['all']);
    expect(sizesForPool(11)).toEqual(['10', 'all']);
    expect(sizesForPool(100)).toEqual(['10', '20', '30', '50', '90', 'all']);
    expect(sizesForPool(101)).toEqual(['20', '30', '50', '90', 'all']);
    expect(sizesForPool(120)).toEqual(['20', '30', '50', '90', 'all']);
    expect(sizesForPool(121)).toEqual(['20', '30', '50', '90', '120', 'all']);
  });
});

describe('quiz scopes against the real catalogue', () => {
  const countries = allCountries();
  const counts = Object.fromEntries(QUIZ_SCOPES.map(s => [s, poolForScope(countries, s).length]));

  it('has the pool sizes the catalogue promises', () => {
    expect(counts).toEqual({ world: 197, africa: 54, asia: 48, europe: 46, americas: 35, oceania: 14 });
  });

  it('every continent pool partitions the world', () => {
    const continents = QUIZ_SCOPES.filter(s => s !== 'world');
    expect(continents.reduce((n, s) => n + counts[s], 0)).toBe(counts.world);
  });

  it('derives the ladder per scope from the pool size', () => {
    expect(sizesForPool(counts.world)).toEqual(['20', '30', '50', '90', '120', 'all']);
    expect(sizesForPool(counts.oceania)).toEqual(['10', 'all']);
    expect(sizesForPool(counts.africa)).toEqual(['10', '20', '30', '50', 'all']);
    expect(sizesForPool(counts.asia)).toEqual(['10', '20', '30', 'all']);
    expect(sizesForPool(counts.europe)).toEqual(['10', '20', '30', 'all']);
    expect(sizesForPool(counts.americas)).toEqual(['10', '20', '30', 'all']);
  });

  it('"top N" is the N most populous WITHIN the scope', () => {
    const africa = poolForScope(countries, 'africa');
    const top10 = topByPopulation(africa, '10');
    expect(top10).toHaveLength(10);
    expect(top10.every(c => c.region === 'Africa')).toBe(true);
    const cutoff = top10[top10.length - 1].population;
    const rest = africa.filter(c => !top10.includes(c));
    for (const c of rest) expect(c.population).toBeLessThanOrEqual(cutoff);
  });

  it('isQuizScope accepts only the six scopes', () => {
    for (const s of QUIZ_SCOPES) expect(isQuizScope(s)).toBe(true);
    for (const bad of ['World', 'antarctica', '', 'americas ']) expect(isQuizScope(bad)).toBe(false);
  });
});

describe('topByPopulation', () => {
  const countries = allCountries();

  it('returns exactly N countries, most populous first', () => {
    const top20 = topByPopulation(countries, '20');
    expect(top20).toHaveLength(20);
    for (let i = 1; i < top20.length; i++) {
      expect(top20[i - 1].population).toBeGreaterThanOrEqual(top20[i].population);
    }
  });

  it('"all" returns every country, in the same population order', () => {
    const all = topByPopulation(countries, 'all');
    expect(all).toHaveLength(countries.length);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].population).toBeGreaterThanOrEqual(all[i].population);
    }
  });

  it('does not mutate the input array', () => {
    const before = countries.map(c => c.iso3);
    topByPopulation(countries, '20');
    expect(countries.map(c => c.iso3)).toEqual(before);
  });

  it('the top 20 is a subset of the top 50 is a subset of "all"', () => {
    const top20 = new Set(topByPopulation(countries, '20').map(c => c.iso3));
    const top50 = new Set(topByPopulation(countries, '50').map(c => c.iso3));
    for (const iso3 of top20) expect(top50.has(iso3)).toBe(true);
  });
});

/** Minimal fake features — only the fields quizFillFor/quizStrokeFor actually read. */
function fakeFeature(iso3: string, neighbours: Feature[] = []): Feature {
  return {
    country: { iso3 } as Feature['country'],
    polygons: [],
    bbox: null,
    anchor: [0, 0],
    ux: 0,
    uy: 0,
    tiny: false,
    path: null,
    fullPath: null,
    neighbours
  };
}

describe('quizFillFor / quizStrokeFor', () => {
  const target = fakeFeature('AAA');
  const neighbour = fakeFeature('BBB');
  (target.neighbours as Feature[]).push(neighbour);
  const stranger = fakeFeature('CCC');

  it('paints an answered-correct country mastered-green regardless of anything else', () => {
    const quiz = { target, answered: new Map([['BBB', 'correct' as const]]), showNeighbours: true, paused: false };
    expect(quizFillFor(neighbour, quiz)).toBe(MASTERY_COLOURS.mastered);
  });

  it('paints an answered-revealed country learning-amber', () => {
    const quiz = { target, answered: new Map([['CCC', 'revealed' as const]]), showNeighbours: false, paused: false };
    expect(quizFillFor(stranger, quiz)).toBe(MASTERY_COLOURS.learning);
  });

  it('paints the current target brass, and everything unanswered/unrelated plain land', () => {
    const quiz = { target, answered: new Map(), showNeighbours: false, paused: false };
    expect(quizFillFor(target, quiz)).toBe(SELECTED);
    expect(quizFillFor(stranger, quiz)).toBe(LAND);
  });

  it('neighbour glow is off unless explicitly turned on, even for the target\'s real neighbour', () => {
    const off = { target, answered: new Map(), showNeighbours: false, paused: false };
    expect(quizFillFor(neighbour, off)).toBe(LAND);

    const on = { target, answered: new Map(), showNeighbours: true, paused: false };
    expect(quizFillFor(neighbour, on)).toBe(NEIGHBOUR);
  });

  it('an answered outcome always wins over the target/neighbour glow (a target cannot also be "answered" while active, but the priority order matters for stroke too)', () => {
    const quiz = { target, answered: new Map([['AAA', 'correct' as const]]), showNeighbours: false, paused: false };
    const [colour] = quizStrokeFor(target, quiz);
    expect(colour).toBe('#F5CE86'); // target's own stroke — still the active question
    expect(quizFillFor(target, quiz)).toBe(MASTERY_COLOURS.mastered); // but its fill reflects the answer
  });
});

describe('the flags quiz\'s confusable-pair match', () => {
  const match = quizDefinition('flags')!.match!;

  it('accepts the target\'s confusable twin, with a note naming the real target', () => {
    const chad = countryBySlug('chad')!;
    const outcome = match('Romania', chad);
    expect(outcome?.accepted).toBe(true);
    expect(outcome?.note).toContain('Chad');
  });

  it('works both directions — Chad is also accepted for Romania', () => {
    const romania = countryBySlug('romania')!;
    const outcome = match('Chad', romania);
    expect(outcome?.accepted).toBe(true);
  });

  it('returns null (fall through to the default matcher) for an unrelated guess', () => {
    const chad = countryBySlug('chad')!;
    expect(match('France', chad)).toBeNull();
  });

  it('returns null for a country with no curated twin at all', () => {
    const bulgaria = countryBySlug('bulgaria')!;
    expect(match('Romania', bulgaria)).toBeNull();
  });
});
