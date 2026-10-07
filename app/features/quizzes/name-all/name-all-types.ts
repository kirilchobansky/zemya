/**
 * Types and constants shared by the "Name all countries" run screen (NameAllQuiz.tsx and its parts).
 */
export type Phase = 'idle' | 'running' | 'done' | 'gaveup';

export interface Outcome {
  beatBest: boolean;
  previousBest: number | null;
}

/** How long an exact name that is also the start of another unnamed country waits for a further key. */
export const AUTO_ACCEPT_MS = 500;
export const NO_NAMED: readonly string[] = [];
