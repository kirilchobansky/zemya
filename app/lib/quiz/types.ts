/**
 * The shape a quiz presenter supplies to the shared engine (./engine.ts) and route
 * (routes/quiz.$quizId.tsx). Adding a new quiz — "Name the Capital", say — means adding
 * one QuizDefinition to app/lib/geography/quizzes.ts's registry, never a new route tree.
 * See CLAUDE.md's Quizzes section.
 */
import type { ChangeEvent, ComponentType, KeyboardEvent, RefObject } from 'react';

import type { Facet } from '~/lib/geography/mastery';
import type { CountryRecord } from '~/lib/map/types';

export type QuizPhase = 'idle' | 'running' | 'paused' | 'done';
export type QuizOutcome = 'correct' | 'revealed';

/** Where a Stage's own JSX is meant to land — see CLAUDE.md's Quizzes section for why this
 *  exists: a quiz that needs a control the generic panel doesn't know about (the
 *  countries quiz's neighbour-glow toggle) renders it itself, in the slot that asked for
 *  it, rather than the engine growing a bespoke prop for every future quiz's one-off
 *  control. Most Stages only care about 'stage'. */
export type QuizSlot = 'stage' | 'panel';

export interface QuizStageProps {
  slot: QuizSlot;
  phase: QuizPhase;
  /** The country currently being asked about. Null before START and during results. */
  target: CountryRecord | null;
  /** True once the current target has been revealed (Ctrl+Enter). */
  revealed: boolean;
  input: string;
  onInputChange(e: ChangeEvent<HTMLInputElement>): void;
  onInputKeyDown(e: KeyboardEvent<HTMLInputElement>): void;
  inputRef: RefObject<HTMLInputElement | null>;
  onStart(): void;
  /** Off by default; a manual toggle is the countries quiz's own business (see
   *  CLAUDE.md) — most Stages ignore this pair entirely. */
  showNeighbours: boolean;
  toggleShowNeighbours(): void;
}

/** What a definition's `match` returns for one keystroke — see engine.ts's resolveMatch. */
export interface MatchOutcome {
  accepted: boolean;
  /** Shown when accepted through a special-case rule rather than the plain name match —
   *  e.g. the flags quiz's confusable-pair exception (CLAUDE.md's Quizzes section). */
  note?: string;
}

export interface QuizDefinition {
  id: string;
  title: string;
  description: string;
  /** Which FSRS card grade() writes to: geo:<ISO3>:<facet>. */
  facet: Facet;
  /** Renders what the player sees for the current target — see QuizSlot above. */
  Stage: ComponentType<QuizStageProps>;
  /** Called with the upcoming targets (current plus lookahead) whenever the queue
   *  advances, so a presenter can preload something heavier than a name — e.g. the flags
   *  quiz preloading SVGs so a 200+ KB flag never hitches mid-run. */
  prepare?(targets: CountryRecord[]): void;
  /** The map marks the target country's capital with the quiz-target ring (the capitals
   *  quiz). Read by routes/quiz.$quizId.tsx, which puts it on the QuizOverride the
   *  renderer reads — no other quiz has a capital to mark. */
  markCapital?: boolean;
  /** Extra acceptance rule layered on top of the default name match (matchesCountry) —
   *  return null to fall through to it. The only current use is the flags quiz's
   *  confusable-pair exception; most quizzes omit this entirely. */
  match?(typed: string, target: CountryRecord): MatchOutcome | null;
}

export interface QuizRunResult {
  timeMs: number;
  firstTryCount: number;
  revealed: CountryRecord[];
  beatBest: boolean;
  /** The best time going INTO this run, snapshotted at finish time — see engine.ts. */
  previousBest: number | null;
}
