/**
 * "Up" for the right panel's header button (components/UpButton.tsx): a fixed hierarchy, one
 * level up per press. It is never browser history — no history.back, no navigate(-1) — so the
 * parent is the same whichever page was visited before.
 *
 *   Quizzes:   /quizzes (root, no button)
 *              > /quizzes/:subject, /quizzes/history, /quizzes/history/:slug
 *              > a quiz's start screen (a run route before START)
 *              > an active run (or its results) — Up leaves it like Abandon and lands on the start screen
 *   History:   /history (root, no button) > /history/:slug > an opened entry (state, not a route)
 *
 * Everywhere else (map, country pages, Questions, each section's root) there is no button.
 *
 * Two levels are state inside a route, not a URL: a run's phase and History's opened entry. A
 * route registers its own step for them with `useUpStep`; the panel's button prefers it, and
 * falls back to `parentPath` when none is registered.
 */
import { useContext, useEffect, useRef } from 'react';

import { AtlasContext } from '~/lib/atlas-context';

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
