/**
 * "Up" for the right panel's header button (features/map/components/UpButton.tsx): a fixed hierarchy, one
 * level up per press. It is never browser history — no history.back, no navigate(-1) — so the
 * parent is the same whichever page was visited before.
 *
 *   Quizzes:   /quizzes (root, no button)
 *              > /quizzes/:subject, /quizzes/history, /quizzes/history/:slug
 *              > a quiz's start screen (a run route before START)
 *              > an active run or its results — Up leaves it like Abandon, to the list with that quiz open
 *   History:   /history (root, no button) > /history/:slug > an opened entry (state, not a route)
 *
 * Everywhere else (map, country pages, Questions, each section's root) there is no button.
 *
 * Two levels are state inside a route, not a URL: a run's phase and History's opened entry. A
 * route registers its own step for them with `useUpStep`; the panel's button prefers it, and
 * falls back to `parentPath` when none is registered.
 */
import { useContext, useEffect, useRef } from 'react';

import { AtlasContext } from './atlas-context';

/** The URL one level up, or null where Up does not exist. Pure, so it is unit-tested. */
export function parentPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const [first, second] = segments;
  if (first === 'quizzes' && segments.length > 1) {
    if (second === 'history') {
      // /quizzes/history -> /quizzes; /:slug -> the country list; /:slug/:quizId -> that country's quizzes
      return segments.length <= 2 ? '/quizzes' : `/${segments.slice(0, segments.length === 3 ? 2 : 3).join('/')}`;
    }
    // /quizzes/:subject -> /quizzes; a run (/quizzes/:subject/:quizId/:scope/:size) -> its subject's list
    return segments.length === 2 ? '/quizzes' : `/quizzes/${second}`;
  }
  if (first === 'history' && segments.length === 2) return '/history';
  return null;
}

/** A quiz run (or a run's start screen): /quizzes/:subject/:quizId/:scope/:size, or a history
 *  fill run /quizzes/history/:slug/:quizId. Leaving one replaces its history entry (docs/structure.md). */
export function isQuizRunPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'quizzes') return false;
  return segments[1] === 'history' ? segments.length === 4 : segments.length === 5;
}

/** Location state for going back to a subject's quiz list from a geography run: the sheet at full
 *  height and the quiz (with its scope) the run was, left open. History fill runs have no such list. */
export function listReturnState(pathname: string): { sheet: 'full'; openQuiz?: string; openScope?: string } {
  const [, subject, quizId, scope] = pathname.split('/').filter(Boolean);
  return isQuizRunPath(pathname) && subject !== 'history' ? { sheet: 'full', openQuiz: quizId, openScope: scope } : { sheet: 'full' };
}

/** Where a dossier opened from a finished quiz's results goes Back to: the run's URL
 *  (path + search) and the token of the results saved for it (features/quizzes/engine/finished-runs.ts).
 *  Like Up, a fixed return, never browser history: neighbour links inside the dossier carry it on. */
export interface QuizReturn { to: string; token: string }

export function quizReturnState(to: string, token: string): { quizReturn: QuizReturn } {
  return { quizReturn: { to, token } };
}

export function readQuizReturn(state: unknown): QuizReturn | null {
  const r = (state as { quizReturn?: Partial<QuizReturn> } | null)?.quizReturn;
  return typeof r?.to === 'string' && typeof r.token === 'string' ? { to: r.to, token: r.token } : null;
}

/** State of the navigation Back makes: the run route restores the results saved under this token. */
export function restoreRunState(token: string): { restoreRun: string } {
  return { restoreRun: token };
}

export function readRestoreToken(state: unknown): string | null {
  const t = (state as { restoreRun?: unknown } | null)?.restoreRun;
  return typeof t === 'string' ? t : null;
}

/**
 * Registers `step` as what Up does on this screen while `active` (an in-route level to leave
 * first: a run in progress, an opened detail). Cleared when `active` turns false or the route
 * unmounts, which gives the button back to `parentPath`.
 */
export function useUpStep(active: boolean, step: () => void): void {
  const setUpStep = useContext(AtlasContext)?.setUpStep;
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    if (!active || !setUpStep) return;
    setUpStep(() => stepRef.current());
    return () => setUpStep(null);
  }, [active, setUpStep]);
}
