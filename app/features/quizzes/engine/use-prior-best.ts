/**
 * The player's best time for this quiz/scope/size, loaded when they change. The engine
 * updates it locally after a run so the next result compares against the new best.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import { bestQuizTime } from '~/features/progress';

export function usePriorBest(quizId: string, scope: string, size: string): [number | null, Dispatch<SetStateAction<number | null>>] {
  const [priorBest, setPriorBest] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    bestQuizTime(quizId, scope, size).then(best => { if (!cancelled) setPriorBest(best); });
    return () => { cancelled = true; };
  }, [quizId, scope, size]);

  return [priorBest, setPriorBest];
}
