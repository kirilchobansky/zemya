/**
 * The quiz engine's public shape and constants. Kept apart from the hook so the pieces
 * (engine.ts, use-quiz-keyboard.ts, use-quiz-timer.ts) can share them without importing
 * each other.
 */
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

import { matchesCountry } from '~/features/countries';
import type { CountryRecord } from '~/engines/map/types';
import type { MatchOutcome, QuizDefinition, QuizOutcome, QuizPhase, QuizRunResult } from './types';

/** Grading thresholds mapped onto FSRS's four ratings — see CLAUDE.md's Quizzes section. */
export const EASY_MS = 5000;

/** How many upcoming targets (current + lookahead) a definition's prepare() sees — enough
 *  for the flags quiz to preload the heaviest SVGs (200+ KB) before they're needed. */
export const PREPARE_LOOKAHEAD = 3;

export interface QuizEngine {
  phase: QuizPhase;
  target: CountryRecord | null;
  input: string;
  revealedSet: ReadonlySet<string>;
  answered: ReadonlyMap<string, QuizOutcome>;
  answeredCount: number;
  totalCount: number;
  /** Countries still unanswered, current target included — queue.length, without exposing
   *  the queue itself. Skip is only meaningful with at least one country besides it. */
  remainingCount: number;
  /** Live — moves every ~200ms while running, frozen while paused or done. */
  elapsedMs: number;
  showNeighbours: boolean;
  toggleShowNeighbours(): void;
  /** Set when the last accepted answer came through a definition's `match` exception
   *  (see the flags quiz's confusable pairs) rather than the plain name match — cleared
   *  as soon as the player starts typing the next answer. */
  lastNote: string | null;
  result: QuizRunResult | null;
  /** True during a "Review mistakes" run (and its results): replays the previous run's revealed
   *  countries, saves nothing but the FSRS grading. */
  reviewing: boolean;
  priorBest: number | null;
  start(): void;
  /** Replays the finished run's revealed countries — only meaningful with a result. */
  reviewMistakes(): void;
  /** Starts a fresh run over an active one — nothing saved, no FSRS grading — on `next`, a newly
   *  drawn set (the route passes it; omitted = reshuffle the current set). */
  restart(next?: CountryRecord[]): void;
  skip(): void;
  reveal(): void;
  togglePause(): void;
  abandon(): void;
  /** Leave a run (or its results) for the start screen, nothing saved — the panel's Up button. */
  toStart(): void;
  onInputChange(e: ChangeEvent<HTMLInputElement>): void;
  onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>): void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/** Resolves one keystroke against the target: the definition's own `match` first (for a
 *  quiz's special-case acceptances), falling back to the plain name match everyone gets
 *  for free — see names.ts's own "no fuzzy matching" doc comment for why that fallback is
 *  exact, not fuzzy. */
export function resolveMatch(
  typed: string,
  target: CountryRecord,
  definition: Pick<QuizDefinition, 'match'>
): MatchOutcome {
  return definition.match?.(typed, target) ?? { accepted: matchesCountry(typed, target) };
}

/** How long a revealed answer sits in the input before Enter's auto-fill accepts it. */
export const REVEAL_FILL_MS = 250;
