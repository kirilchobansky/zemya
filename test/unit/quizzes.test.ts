/**
 * Unit tests for the quiz catalogue's pure logic (app/lib/geography/quizzes.ts) and the
 * quiz-mode fill/stroke functions (app/lib/geography/overlays.ts), checked against the
 * real, shipped catalogue.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from "vitest";

import { allCountries, countryBySlug } from "~/lib/geography/catalog.server";
import { quizDefinition, randomSubset } from "~/lib/geography/quizzes";
import {
  isQuizScope,
  isQuizSize,
  LEGACY_SCOPES,
  poolForScope,
  QUIZ_SCOPES,
  QUIZ_SIZES,
  sizesForPool,
} from "~/lib/geography/scopes";
import {
  quizFillFor,
  quizStrokeFor,
  MASTERY_COLOURS,
  SELECTED,
  NEIGHBOUR,
  LAND,
} from "~/lib/geography/overlays";
import type { Feature } from "~/lib/map/types";

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

/** Minimal fake features — only the fields quizFillFor/quizStrokeFor actually read. */
function fakeFeature(iso3: string, neighbours: Feature[] = []): Feature {
  return {
    country: { iso3 } as Feature["country"],
    polygons: [],
    bbox: null,
    anchor: [0, 0],
    ux: 0,
    uy: 0,
    tiny: false,
    path: null,
    fullPath: null,
    neighbours,
  };
}

describe("quizFillFor / quizStrokeFor", () => {
  const target = fakeFeature("AAA");
  const neighbour = fakeFeature("BBB");
  (target.neighbours as Feature[]).push(neighbour);
  const stranger = fakeFeature("CCC");

  it("paints an answered-correct country mastered-green regardless of anything else", () => {
    const quiz = {
      target,
      answered: new Map([["BBB", "correct" as const]]),
      showNeighbours: true,
      paused: false,
    };
    expect(quizFillFor(neighbour, quiz)).toBe(MASTERY_COLOURS.mastered);
  });

  it("paints an answered-revealed country red — never the target's brass, which is the same value as amber", () => {
    const quiz = {
      target,
      answered: new Map([["CCC", "revealed" as const]]),
      showNeighbours: false,
      showCapital: false,
      paused: false,
    };
    expect(quizFillFor(stranger, quiz)).toBe(MASTERY_COLOURS.new);
    // the three meanings never share a colour: question / didn't know / got it
    const meanings = [SELECTED, MASTERY_COLOURS.new, MASTERY_COLOURS.mastered];
    expect(new Set(meanings).size).toBe(3);
  });

  it("paints the current target brass, and everything unanswered/unrelated plain land", () => {
    const quiz = {
      target,
      answered: new Map(),
      showNeighbours: false,
      paused: false,
    };
    expect(quizFillFor(target, quiz)).toBe(SELECTED);
    expect(quizFillFor(stranger, quiz)).toBe(LAND);
  });

  it("neighbour glow is off unless explicitly turned on, even for the target's real neighbour", () => {
    const off = {
      target,
      answered: new Map(),
      showNeighbours: false,
      paused: false,
    };
    expect(quizFillFor(neighbour, off)).toBe(LAND);

    const on = {
      target,
      answered: new Map(),
      showNeighbours: true,
      paused: false,
    };
    expect(quizFillFor(neighbour, on)).toBe(NEIGHBOUR);
  });

  it('an answered outcome always wins over the target/neighbour glow (a target cannot also be "answered" while active, but the priority order matters for stroke too)', () => {
    const quiz = {
      target,
      answered: new Map([["AAA", "correct" as const]]),
      showNeighbours: false,
      paused: false,
    };
    const [colour] = quizStrokeFor(target, quiz);
    expect(colour).toBe("#F5CE86"); // target's own stroke — still the active question
    expect(quizFillFor(target, quiz)).toBe(MASTERY_COLOURS.mastered); // but its fill reflects the answer
  });
});

describe("the flags quiz's confusable-pair match", () => {
  const match = quizDefinition("flags")!.match!;

  it("accepts the target's confusable twin, with a note naming the real target", () => {
    const chad = countryBySlug("chad")!;
    const outcome = match("Romania", chad);
    expect(outcome?.accepted).toBe(true);
    expect(outcome?.note).toContain("Chad");
  });

  it("works both directions — Chad is also accepted for Romania", () => {
    const romania = countryBySlug("romania")!;
    const outcome = match("Chad", romania);
    expect(outcome?.accepted).toBe(true);
  });

  it("returns null (fall through to the default matcher) for an unrelated guess", () => {
    const chad = countryBySlug("chad")!;
    expect(match("France", chad)).toBeNull();
  });

  it("returns null for a country with no curated twin at all", () => {
    const bulgaria = countryBySlug("bulgaria")!;
    expect(match("Romania", bulgaria)).toBeNull();
  });
});

describe("the capitals quiz", () => {
  const definition = quizDefinition("capitals")!;
  const match = (typed: string, slug: string) =>
    definition.match!(typed, countryBySlug(slug)!);

  it("is registered, grades the existing capital facet, and marks the target capital", () => {
    expect(definition.title).toBe("Name the Capital");
    expect(definition.facet).toBe("capital");
    expect(definition.markCapital).toBe(true);
  });

  it("accepts the capital, its curated alternates and diacritic-free spellings", () => {
    expect(match("Sofia", "bulgaria")?.accepted).toBe(true);
    expect(match("kiev", "ukraine")?.accepted).toBe(true);
    expect(match("Brasilia", "brazil")?.accepted).toBe(true);
    expect(match("Cape Town", "south-africa")?.accepted).toBe(true);
  });

  it("never accepts the COUNTRY name as the answer, and never falls through to the country matcher", () => {
    // a null return would make the engine fall back to matchesCountry — "France" answering
    // "capital of France" — so every input must produce a real outcome
    expect(match("France", "france")).toEqual({ accepted: false });
    expect(match("Bulgaria", "bulgaria")).toEqual({ accepted: false });
    expect(match("", "bulgaria")).toEqual({ accepted: false });
  });

  it("does not accept another country's capital, or a typo", () => {
    expect(match("Bucharest", "bulgaria")?.accepted).toBe(false);
    expect(match("Sofya", "bulgaria")?.accepted).toBe(false);
  });

  it("the size ladder and scopes are the shared ones — every scope/size the others have", () => {
    // nothing quiz-specific to assert about sizes: the route derives them from the pool,
    // not the definition. This pins that a definition carries no size list of its own.
    expect(Object.keys(definition).sort()).toEqual([
      "Stage",
      "description",
      "facet",
      "id",
      "markCapital",
      "match",
      "seoName",
      "seoTask",
      "title",
    ]);
  });
});
