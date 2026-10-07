/**
 * Unit tests for the quiz catalogue's pure logic (app/features/quizzes/geography/quizzes.ts): size ladders, scopes
 * against the real, shipped catalogue, and the random / population subsets.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from "vitest";
import { allCountries } from "~/features/countries/catalog.server";
import { isQuizScope, isQuizSize, LEGACY_SCOPES, poolForScope, QUIZ_SCOPES, QUIZ_SIZES, sizesForPool } from '~/features/countries';
import { populationSubset, randomSubset, selectQuizCountries } from "./quizzes";

describe("isQuizSize", () => {
  it("accepts every literal in QUIZ_SIZES", () => {
    for (const size of QUIZ_SIZES) expect(isQuizSize(size)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["0", "20 ", "All", "", "19", "twenty"])
      expect(isQuizSize(bad)).toBe(false);
  });
});

describe("sizesForPool — the ladder is computed from the pool by one rule", () => {
  it("yields exactly the seven rows the catalogue promises, for the real pool sizes", () => {
    const rows: [string, number, string[]][] = [
      ["World", 197, ["20", "30", "50", "90", "120", "all"]],
      ["Africa", 54, ["10", "20", "30", "all"]],
      ["Asia", 48, ["10", "20", "30", "all"]],
      ["Europe", 46, ["10", "20", "30", "all"]],
      ["North America", 23, ["10", "all"]],
      ["South America", 12, ["all"]],
      ["Oceania", 14, ["all"]],
    ];
    for (const [name, pool, expected] of rows) {
      expect(sizesForPool(pool), `${name} (${pool})`).toEqual(expected);
    }
  });

  it("a pool of 12 and a pool of 14 both yield All alone", () => {
    expect(sizesForPool(12)).toEqual(["all"]);
    expect(sizesForPool(14)).toEqual(["all"]);
  });

  it("always includes All, last, for every pool including a pool of 1", () => {
    for (const pool of [0, 1, 2, 10, 11, 12, 100, 197, 500]) {
      const sizes = sizesForPool(pool);
      expect(sizes[sizes.length - 1], `pool ${pool}`).toBe("all");
    }
    expect(sizesForPool(1)).toEqual(["all"]);
  });

  it("keeps a rung S only when 0.08 * N <= S <= 0.68 * N, boundaries inclusive", () => {
    expect(sizesForPool(125)).toEqual(["10", "20", "30", "50", "all"]); // 10 = 0.08*125 exactly; 90 > 0.68*125 = 85
    expect(sizesForPool(126)).not.toContain("10");
    expect(sizesForPool(50)).toContain("30"); // 30 <= 0.68*50 = 34
    expect(sizesForPool(44)).not.toContain("30"); // 0.68*44 = 29.92 < 30
    expect(sizesForPool(45)).toContain("30"); // 0.68*45 = 30.6
  });
});

describe("quiz scopes against the real catalogue", () => {
  const countries = allCountries();
  const counts = Object.fromEntries(
    QUIZ_SCOPES.map((s) => [s, poolForScope(countries, s).length]),
  );

  it("has the pool sizes the catalogue promises", () => {
    expect(counts).toEqual({
      world: 197,
      africa: 54,
      asia: 48,
      europe: 46,
      "north-america": 23,
      "south-america": 12,
      oceania: 14,
    });
  });

  it("the six continent pools partition the world, with no country in two", () => {
    const continents = QUIZ_SCOPES.filter((s) => s !== "world");
    const iso = continents.flatMap((s) =>
      poolForScope(countries, s).map((c) => c.iso3),
    );
    expect(iso).toHaveLength(counts.world);
    expect(new Set(iso).size).toBe(counts.world);
  });

  it("South America is the subregion; North America is every other Americas country", () => {
    expect(
      poolForScope(countries, "south-america").every(
        (c) => c.subregion === "South America",
      ),
    ).toBe(true);
    const north = poolForScope(countries, "north-america");
    expect(
      north.every(
        (c) => c.region === "Americas" && c.subregion !== "South America",
      ),
    ).toBe(true);
    expect(north.map((c) => c.name)).toEqual(
      expect.arrayContaining(["Mexico", "Cuba", "Canada", "Panama"]),
    );
  });

  it("derives the ladder per scope from the real pool sizes", () => {
    expect(sizesForPool(counts.world)).toEqual([
      "20",
      "30",
      "50",
      "90",
      "120",
      "all",
    ]);
    expect(sizesForPool(counts.africa)).toEqual(["10", "20", "30", "all"]);
    expect(sizesForPool(counts["north-america"])).toEqual(["10", "all"]);
    expect(sizesForPool(counts["south-america"])).toEqual(["all"]);
    expect(sizesForPool(counts.oceania)).toEqual(["all"]);
  });

  it('"top N" is a random N-country subset WITHIN the scope', () => {
    const africa = poolForScope(countries, "africa");
    const top10 = randomSubset(africa, "10");
    expect(top10).toHaveLength(10);
    expect(top10.every((c) => c.region === "Africa")).toBe(true);
  });

  it('isQuizScope accepts only the seven scopes — "americas" is gone but has a redirect', () => {
    for (const s of QUIZ_SCOPES) expect(isQuizScope(s)).toBe(true);
    for (const bad of ["World", "antarctica", "", "americas", "north america"])
      expect(isQuizScope(bad)).toBe(false);
    expect(LEGACY_SCOPES.americas).toBe("world");
  });
});

describe("randomSubset", () => {
  const countries = allCountries();

  it("returns exactly N unique countries", () => {
    const top20 = randomSubset(countries, "20");
    expect(top20).toHaveLength(20);
    expect(new Set(top20.map((c) => c.iso3)).size).toBe(20);
  });

  it('"all" returns every country without sorting by population', () => {
    const all = randomSubset(countries, "all");
    expect(all).toHaveLength(countries.length);
    expect(all.map((c) => c.iso3)).toEqual(countries.map((c) => c.iso3));
  });

  it("does not mutate the input array", () => {
    const before = countries.map((c) => c.iso3);
    randomSubset(countries, "20");
    expect(countries.map((c) => c.iso3)).toEqual(before);
  });

  it("does not require numeric sizes to share the same subset", () => {
    const top20 = new Set(randomSubset(countries, "20").map((c) => c.iso3));
    const top50 = new Set(randomSubset(countries, "50").map((c) => c.iso3));
    expect(top20.size).toBe(20);
    expect(top50.size).toBe(50);
  });
});

describe("populationSubset", () => {
  const countries = allCountries();

  it("returns the most populous countries first", () => {
    const top20 = populationSubset(countries, "20");
    expect(top20).toHaveLength(20);
    for (let index = 1; index < top20.length; index++) {
      expect(top20[index - 1].population).toBeGreaterThanOrEqual(
        top20[index].population,
      );
    }
  });

  it("selectQuizCountries uses the requested mode", () => {
    expect(selectQuizCountries(countries, "20", "population")).toEqual(
      populationSubset(countries, "20"),
    );
  });
});

/** Minimal fake features — only the fields quizFillFor/quizStrokeFor actually read. */
