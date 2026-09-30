/**
 * The "fill the list" quizzes of each history country, spelled out one row per quiz — no
 * quiz is derived from the timeline's periods any more. A row picks entries of one `kind`
 * whose `role` matches a regex and whose START lies in a window, optionally with a toggle
 * that narrows the list. Titles are English; the entries' names stay Bulgarian.
 *
 * Window: `from` is inclusive, `before` exclusive, both authored dates ("681", "1946-09-15")
 * read like the timeline's own (a bare year is the start of that year). "681..1018" is
 * therefore `from: '681', before: '1019'`.
 *
 * Toggle: `{ label }` adds a checkbox (start screen and result screen); on, it drops every
 * entry whose `elected` is false (a missing `elected` counts as true). It is saved with the
 * run — see `toggleSize` — so best times are kept per setting.
 *
 * Pure data, no imports beyond types: fill-quiz.ts, the build-time catalogue and
 * react-router.config.ts (prerender) all read it, so it must load outside the bundler.
 */
import type { FillKind } from './fill-quiz';

export interface FillQuizToggle {
  label: string;
}

export interface FillQuizConfig {
  /** URL segment (/quizzes/history/<id>) and the key personal bests are stored under. */
  id: string;
  title: string;
  kind: FillKind;
  /** Tested against the entry's `role` (an entry with none is tested as ""). */
  role: RegExp;
  from?: string;
  before?: string;
  toggle?: FillQuizToggle;
}

const ANY_ROLE = /(?:)/; // matches every role, an entry with none included

export const BULGARIA_FILL_QUIZZES: readonly FillQuizConfig[] = [
  {
    id: 'bulgaria-rulers-first-empire',
    title: 'Rulers of the First Bulgarian Empire',
    kind: 'ruler', role: ANY_ROLE, from: '681', before: '1019'
  },
  {
    id: 'bulgaria-rulers-second-empire',
    title: 'Rulers of the Second Bulgarian Empire',
    kind: 'ruler', role: ANY_ROLE, from: '1185', before: '1397'
  },
  {
    id: 'bulgaria-rulers-principality-kingdom',
    title: 'Princes and Tsars of Bulgaria',
    kind: 'ruler', role: /княз|цар/, from: '1878', before: '1946-09-15'
  },
  {
    id: 'bulgaria-heads-of-state-peoples-republic',
    title: "Heads of state, People's Republic",
    kind: 'ruler', role: /държавен глава/
  },
  {
    id: 'bulgaria-bkp-leaders',
    title: 'BKP leaders',
    kind: 'ruler', role: /лидер на БКП/
  },
  {
    id: 'bulgaria-presidents',
    title: 'Presidents',
    kind: 'ruler', role: /президент/, // also matches "и.д. президент"
    toggle: { label: 'Democratically elected only' }
  },
  {
    id: 'bulgaria-pms-principality-kingdom',
    title: 'Prime ministers, Principality and Kingdom',
    kind: 'government', role: ANY_ROLE, from: '1878', before: '1946-09-15'
  },
  {
    id: 'bulgaria-pms-peoples-republic',
    title: "Prime ministers, People's Republic",
    kind: 'government', role: ANY_ROLE, from: '1946-09-15', before: '1989-11-10'
  },
  {
    id: 'bulgaria-pms-republic',
    title: 'Prime ministers, Republic',
    kind: 'government', role: ANY_ROLE, from: '1989-11-10'
  }
];

/** Per history-country slug (countries.ts). */
export const FILL_QUIZ_CONFIG: Readonly<Record<string, readonly FillQuizConfig[]>> = {
  bulgaria: BULGARIA_FILL_QUIZZES
};

/** The `size` a run is saved and looked up under: the toggle's two settings are two
 *  separate personal-best tracks. A quiz without a toggle always uses 'all'. */
export const toggleSize = (on: boolean): string => (on ? 'elected' : 'all');
