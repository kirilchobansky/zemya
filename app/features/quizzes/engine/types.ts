/**
 * The shape a quiz presenter supplies to the shared engine (./engine.ts) and route
 * (routes/quizzes/quiz.$quizId.tsx). Adding a new quiz — "Name the Capital", say — means adding
 * one QuizDefinition to app/features/quizzes/geography/quizzes.ts's registry, never a new route tree.
 * See CLAUDE.md's Quizzes section.
 */
import type { ChangeEvent, ComponentType, KeyboardEvent, RefObject } from 'react';

import type { Facet } from '~/features/countries';
import type { CountryRecord, World } from '~/engines/map/types';

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
  /** Must focus the input synchronously, inside the tap (see QuizControls) — the route's handler does. */
  onStart(): void;
  /** Skip / Reveal as callable actions: phones have no Tab or Ctrl+Enter, so the Stage draws buttons. */
  skip(): void;
  reveal(): void;
  canSkip: boolean;
  canReveal: boolean;
  /** Off by default; a manual toggle is the countries quiz's own business (see
   *  CLAUDE.md) — most Stages ignore this pair entirely. */
  showNeighbours: boolean;
  toggleShowNeighbours(): void;
  /** The built world and the run's whole scope pool (before any Top-N cut) — the outlines quiz
   *  draws a country's Path2D and sizes it against the pool's largest country. */
  world: World | null;
  pool: CountryRecord[];
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
  /** What the quiz is called in a search result: "<Scope> <seoName> Quiz" — "Map", "Flags",
   *  "Capitals". See app/features/countries/quizSeo.ts. */
  seoName: string;
  /** What the player does, as one sentence for the page description. */
  seoTask: string;
  /** Which FSRS card grade() writes to: geo:<ISO3>:<facet>. */
  facet: Facet;
  /** Renders what the player sees for the current target — see QuizSlot above. */
  Stage: ComponentType<QuizStageProps>;
  /** Called with the upcoming targets (current plus lookahead) whenever the queue
   *  advances, so a presenter can preload something heavier than a name — e.g. the flags
   *  quiz preloading SVGs so a 200+ KB flag never hitches mid-run. */
  prepare?(targets: CountryRecord[]): void;
  /** The map marks the target country's capital with the quiz-target ring (the capitals
   *  quiz). Read by routes/quizzes/quiz.$quizId.tsx, which puts it on the QuizOverride the
   *  renderer reads — no other quiz has a capital to mark. */
  markCapital?: boolean;
  /** The Stage covers the map (the flags quiz). The route then leaves the camera and the
   *  new-target pulse alone — there is nothing on screen for them to help with. */
  hidesMap?: boolean;
  /** What a reveal shows for a target — the ANSWER string. The engine also types it into the
   *  input when the player presses Enter on a revealed answer. Defaults to the country's name. */
  answerOf?(target: CountryRecord): string;
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
  /** No reveal and no skip: only a perfect run can be a personal best. */
  perfect: boolean;
  /** The best time going INTO this run, snapshotted at finish time — see engine.ts. */
  previousBest: number | null;
}
