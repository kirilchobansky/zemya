import { describe, expect, it } from "vitest";

import { quizPageSeo } from "~/lib/geography/quizSeo";
import { QUIZ_SCOPES, sizesForPool } from "~/lib/geography/scopes";

const capitals = {
  seoName: "Capitals",
  seoTask: "Type the capital of each highlighted country.",
};
const flags = {
  seoName: "Flags",
  seoTask: "Type the country each flag belongs to.",
};

describe("quizPageSeo", () => {
  it("builds the title from quiz, scope and size", () => {
    expect(quizPageSeo(capitals, "africa", "30", 54).title).toBe(
      "Africa Capitals Quiz — Top 30 Countries | Zemya",
    );
    expect(quizPageSeo(flags, "europe", "all", 46).title).toBe(
      "Europe Flags Quiz — All 46 Countries | Zemya",
    );
    expect(
      quizPageSeo({ seoName: "Map", seoTask: "" }, "world", "20", 197).title,
    ).toBe("World Map Quiz — Top 20 Countries | Zemya");
  });

  it("says how many countries, and that it is typed and timed", () => {
    const { description } = quizPageSeo(flags, "europe", "all", 46);
    expect(description).toContain("all 46 Europe countries");
    expect(description).toMatch(/typed/);
    expect(description).toMatch(/timed/);
  });

  it("describes population mode when requested", () => {
    expect(
      quizPageSeo(capitals, "world", "20", 197, "population").description,
    ).toContain("the 20 most populous");
  });

  it("never repeats a title across quiz, scope and size", () => {
    const titles = new Set<string>();
    let n = 0;
    for (const quiz of [capitals, flags]) {
      for (const scope of QUIZ_SCOPES) {
        for (const size of sizesForPool(scope === "world" ? 197 : 40)) {
          titles.add(quizPageSeo(quiz, scope, size, 40).title);
          n++;
        }
      }
    }
    expect(titles.size).toBe(n);
  });
});
