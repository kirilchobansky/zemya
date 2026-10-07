/**
 * Types shared by the "fill the list" run screen (HistoryFillQuiz.tsx and its parts).
 */
export type Phase = 'idle' | 'running' | 'done' | 'gaveup';

export interface Outcome {
  timeMs: number;
  beatBest: boolean;
  previousBest: number | null;
}

export const NO_FILLED: ReadonlySet<string> = new Set();
