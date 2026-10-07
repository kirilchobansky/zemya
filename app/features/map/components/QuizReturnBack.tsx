import { useLocation } from 'react-router';

import { useGo } from '~/shared/lib/navigation';
import { readQuizReturn, restoreRunState } from '../up';
import './QuizReturnBack.css';

/** "← Back to quiz results", shown in a dossier only when it was opened from a finished quiz's
 *  results (location state, see up.ts). A fixed return to the run's URL, replacing the dossier's
 *  history entry; the run route restores the saved results, or shows its start screen if they
 *  are gone. Renders nothing for a dossier reached any other way. */
export function QuizReturnBack() {
  const ret = readQuizReturn(useLocation().state);
  const go = useGo();
  if (!ret) return null;
  return (
    <button
      type="button"
      className="action quiz-return"
      onClick={() => go(ret.to, { state: restoreRunState(ret.token), replace: true })}
    >
      ← Back to quiz results
    </button>
  );
}
