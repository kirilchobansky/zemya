/**
 * Both ends of "Back to quiz results" for a quiz screen (docs/quizzes.md): the link props for a
 * missed country on the results, and the restore of the saved run when Back lands on the route.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router';

import { quizReturnState, readRestoreToken } from '~/features/map';
import { holdQuizCamera, newFinishedRunToken, saveFinishedRun, savedFinishedRun } from './finished-runs';

/** `state` and `onClick` for a results link to a dossier. Following it parks `snapshot()` in
 *  memory under a token the link's state carries. `fresh` changes with each new result. */
export function useResultsReturn(snapshot: () => unknown | null, fresh: unknown) {
  const { pathname, search } = useLocation();
  const key = pathname + search;
  const token = useMemo(newFinishedRunToken, [fresh]);
  return {
    state: quizReturnState(key, token),
    onClick: () => {
      const run = snapshot();
      if (!run) return;
      saveFinishedRun(key, token, run);
      holdQuizCamera();
    }
  };
}

/** Back from a dossier: once the run's data is `ready` and the run is still `idle`, restores the
 *  saved run if the navigation's token matches. Once per token (a later "Try again" returns to
 *  idle). State only — nothing is saved again. */
export function useRestoreFinishedRun<T>(ready: boolean, idle: boolean, restore: (run: T) => void): void {
  const { pathname, search, state } = useLocation();
  const token = readRestoreToken(state);
  const doneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !idle || doneRef.current === token) return;
    const run = savedFinishedRun<T>(pathname + search, token);
    if (!run) return;
    doneRef.current = token;
    restore(run);
  }, [ready, idle, token, pathname, search, restore]);
}
