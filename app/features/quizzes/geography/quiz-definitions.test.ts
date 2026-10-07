/**
 * Unit tests for the quiz definitions (app/features/quizzes/geography/quizzes.ts): the flags quiz's confusable
 * pairs, the capitals and outlines quizzes, and the currency, language and religion quizzes, against the
 * real catalogue.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from "vitest";
import { allCountries, countryBySlug } from "~/features/countries/catalog.server";
import { matchesReligion, normaliseName, BROADER, poolForQuiz, poolForScope, sizesForPool } from '~/features/countries';
import { quizDefinition } from "./quizzes";

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
      "answerOf",
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

describe("the outlines quiz", () => {
  it("is registered and grades the outline facet", () => {
    const quiz = quizDefinition("outlines")!;
    expect(quiz.facet).toBe("outline");
    expect(quiz.hidesMap).toBe(true);
  });

  it("scales by area ^ 0.15 against the pool's largest, floored at 30%", async () => {
    const { outlineShare, OUTLINE_MIN_SHARE } = await import(
      "~/features/countries/outline"
    );
    const world = allCountries();
    const by = (iso3: string) => world.find((c) => c.iso3 === iso3)!;
    expect(outlineShare(by("RUS"), world)).toBe(1);
    expect(outlineShare(by("FRA"), world)).toBeGreaterThan(0.55);
    expect(outlineShare(by("FRA"), world)).toBeLessThan(0.65);
    expect(outlineShare(by("MLT"), world)).toBe(OUTLINE_MIN_SHARE);
    // normalised to the pool: Australia is the largest of Oceania, so it fills the box
    const oceania = poolForScope(world, "oceania");
    expect(outlineShare(by("AUS"), oceania)).toBe(1);
  });

  it("no outline's bounding box spans more than 180 degrees of longitude (unwrapped frame)", async () => {
    class StubPath2D {
      moveTo() {}
      lineTo() {}
      closePath() {}
    }
    (globalThis as { Path2D?: unknown }).Path2D ??= StubPath2D;
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { buildWorld } = await import("~/engines/map/topology");
    const data = JSON.parse(
      readFileSync(
        join(process.cwd(), "public", "data", "geography", "world.json"),
        "utf8",
      ),
    );
    const world = buildWorld(data);
    for (const feature of world.features) {
      if (!feature.bbox) continue;
      expect(
        feature.bbox[2] - feature.bbox[0],
        `${feature.country.iso3} spans too much longitude`,
      ).toBeLessThanOrEqual(180);
    }
  });
});

describe("the currency, language and religion quizzes", () => {
  const typeOf = (id: string, typed: string, slug: string) =>
    quizDefinition(id)!.match!(typed, countryBySlug(slug)!)!.accepted;

  it("are registered on their own facets", () => {
    for (const id of ["currency", "language", "religion"]) {
      expect(quizDefinition(id)!.facet).toBe(id);
    }
  });

  it("currency accepts the full name or the ISO code, never a bare shared word", () => {
    expect(typeOf("currency", "Euro", "spain")).toBe(true);
    expect(typeOf("currency", "eur", "france")).toBe(true);
    expect(typeOf("currency", "JPY", "japan")).toBe(true);
    expect(typeOf("currency", "Renminbi", "china")).toBe(true);
    expect(typeOf("currency", "Vietnamese dong", "vietnam")).toBe(true);
    for (const word of ["dollar", "franc", "peso", "pound", "krona", "krone", "dinar", "rupee"]) {
      for (const country of allCountries()) {
        expect(country.currencyAliases.some((a) => a.toLowerCase() === word), `${country.iso3} ${word}`).toBe(false);
      }
    }
    expect(typeOf("currency", "Spain", "spain")).toBe(false);
  });

  it("language accepts ANY official language, not just the alphabetical first", () => {
    for (const language of ["Spanish", "Guaraní", "guarani"]) expect(typeOf("language", language, language === "Spanish" ? "argentina" : "paraguay")).toBe(true);
    expect(typeOf("language", "Dutch", "belgium")).toBe(true);
    expect(typeOf("language", "German", "belgium")).toBe(true);
    expect(typeOf("language", "French", "belgium")).toBe(true);
    expect(typeOf("language", "Flemish", "belgium")).toBe(true);
    expect(typeOf("language", "Dari", "afghanistan")).toBe(true);
    expect(typeOf("language", "Pashto", "afghanistan")).toBe(true);
    expect(typeOf("language", "Castilian", "spain")).toBe(true);
    expect(typeOf("language", "Mandarin", "china")).toBe(true);
    expect(typeOf("language", "Farsi", "iran")).toBe(true);
    expect(typeOf("language", "Persian", "iran")).toBe(true);
    expect(typeOf("language", "French", "germany")).toBe(false);
    expect(typeOf("language", "Germany", "germany")).toBe(false);
  });

  it("religion accepts synonyms that keep the distinction and rejects broader terms", () => {
    expect(typeOf("religion", "Roman Catholicism", "italy")).toBe(true);
    expect(typeOf("religion", "Catholic", "italy")).toBe(true);
    expect(typeOf("religion", "Orthodox", "bulgaria")).toBe(true);
    expect(typeOf("religion", "Sunni", "egypt")).toBe(true);
    expect(typeOf("religion", "Christianity", "italy")).toBe(false);
    expect(typeOf("religion", "Christianity", "bulgaria")).toBe(false);
    expect(typeOf("religion", "Islam", "egypt")).toBe(false);
    expect(typeOf("religion", "Islam", "iran")).toBe(false);
    expect(typeOf("religion", "Buddhism", "thailand")).toBe(false);
    expect(typeOf("religion", "Protestantism", "sweden")).toBe(false);
  });

  it("religion: no country accepts a term broader than its own value (whole catalogue)", () => {
    const broader = new Set(Object.values(BROADER).map(normaliseName));
    for (const country of allCountries()) {
      if (country.disputed.religion) continue;
      const parts = country.religion.split(" / ").map(normaliseName);
      for (const term of broader) {
        if (parts.includes(term)) continue; // the country's own (broad) value
        expect(matchesReligion(term, country), `${country.iso3} accepts "${term}"`).toBe(false);
      }
    }
  });

  it("pools exclude a disputed or missing facet; the ladder follows the pool", () => {
    const countries = allCountries();
    const world = poolForQuiz(countries, "religion", "world");
    expect(world.length).toBe(countries.length - countries.filter((c) => c.disputed.religion || !c.religion).length);
    expect(world.some((c) => c.slug === "nigeria")).toBe(false);
    expect(poolForQuiz(countries, "religion", "africa").length).toBe(poolForScope(countries, "africa").length - 1);
    expect(poolForQuiz(countries, "capitals", "world").length).toBe(countries.length);
    for (const id of ["currency", "language"]) {
      expect(poolForQuiz(countries, id, "world").every((c) => (id === "currency" ? c.currencyCode : c.languages.length))).toBe(true);
    }
    expect(sizesForPool(world.length).at(-1)).toBe("all");
  });
});
