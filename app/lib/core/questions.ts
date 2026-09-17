/**
 * Generic quiz question shape and a seeded RNG. No geography knowledge here — a future
 * history quiz reuses this file unchanged, the same way it will reuse scheduler.ts.
 */

export interface Question {
  id: string;
  cardId: string;
  /** A subject-specific string (geography's nine kinds live in ~/lib/geography/questions). */
  kind: string;
  prompt: string;
  /** Set only by a flag-image kind: an iso2 code, rendered instead of describing the flag. */
  promptFlag?: string;
  options: string[];
  answerIndex: number;
  hook: string;
}

/**
 * Deterministic seeded PRNG (mulberry32). Same seed, same sequence, forever — this is what
 * makes "same seed -> byte-identical question, twice" a testable property rather than a
 * hope. Not cryptographic; it doesn't need to be.
 */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return function rng() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle against the given RNG. Does not mutate the input. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The first n items of a random shuffle — never repeats an item. */
export function sample<T>(items: readonly T[], n: number, rng: () => number): T[] {
  return shuffle(items, rng).slice(0, n);
}
