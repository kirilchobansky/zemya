/**
 * Unit tests for the quiz-mode fill/stroke functions (app/features/countries/overlays.ts).
 *
 *   npm run test:unit
 */
import { describe, expect, it } from "vitest";
import { quizFillFor, quizStrokeFor, MASTERY_COLOURS, SELECTED, NEIGHBOUR, LAND } from '~/features/countries';
import type { Feature } from "~/engines/map/types";

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
