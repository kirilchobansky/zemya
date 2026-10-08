/**
 * What a finished run leaves behind: its results, whether it was a "Review mistakes" pass, and the
 * archive row a review appends to. Also the snapshot/restore pair that lets the results survive a
 * visit to a dossier (finished-runs.ts). Restoring only sets state — it never saves anything.
 */
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { CountryRecord } from '~/engines/map/types';
import type { FinishedRun } from './finished-runs';
import type { QuizPhase, QuizRunResult } from './types';

export function useQuizReview({ countries, revealedSet, setRevealedSet, setRunList, setPhase }: {
  countries: CountryRecord[];
  revealedSet: ReadonlySet<string>;
  setRevealedSet: Dispatch<SetStateAction<ReadonlySet<string>>>;
  setRunList: Dispatch<SetStateAction<CountryRecord[] | null>>;
  setPhase: Dispatch<SetStateAction<QuizPhase>>;
}) {
  /** A "Review mistakes" run: the revealed countries of the run before, replayed. Graded by FSRS
   *  like any run; its time joins the full run's archive row as the next try, and it is never
   *  a personal best. */
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<QuizRunResult | null>(null);
  /** The full run's countries while a review pass replays only part of them: the rest stay
   *  painted as answered (engine.ts `settled`). Null outside a review. */
  const [fullList, setFullList] = useState<CountryRecord[] | null>(null);
  /** The full run's archive row; review passes append to it. */
  const savedRunRef = useRef<Promise<number | undefined>>(Promise.resolve(undefined));

  const snapshot = useCallback((): FinishedRun | null => (
    result ? { result, countries, revealedSet, reviewing, fullList, savedRun: savedRunRef.current } : null
  ), [result, countries, revealedSet, reviewing, fullList]);

  const restoreResult = useCallback((run: FinishedRun) => {
    savedRunRef.current = run.savedRun;
    setRunList(run.countries);
    setRevealedSet(run.revealedSet);
    setReviewing(run.reviewing);
    setFullList(run.fullList);
    setResult(run.result);
    setPhase('done');
  }, [setRunList, setRevealedSet, setPhase]);

  return { reviewing, setReviewing, result, setResult, fullList, setFullList, savedRunRef, snapshot, restoreResult };
}
