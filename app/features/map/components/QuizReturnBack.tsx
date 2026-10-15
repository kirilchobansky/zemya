import { Link } from 'react-router';

import { useGo } from '~/shared/lib/navigation';
import { restoreRunState } from '../up';
import { useResultsSession } from '../results-session';
import './QuizReturnBack.css';

/** "← Back to quiz results" with the missed countries under it, shown in a dossier while a
 *  finished quiz's results are parked (results-session.ts). A fixed return to the run's URL,
 *  replacing the dossier's history entry; the run route restores the saved results, or shows its
 *  start screen if they are gone. Renders nothing otherwise. */
export function QuizReturnBack() {
  const session = useResultsSession();
  const go = useGo();
  if (!session) return null;
  return (
    <>
      <button
        type="button"
        className="action quiz-return"
        onClick={() => go(session.to, { state: restoreRunState(session.token), replace: true })}
      >
        ← Back to quiz results
      </button>
      {session.missed.length > 0 && (
        <div className="neighbours quiz-return__missed">
          {session.missed.map(c => (
            <Link className="neighbour" key={c.slug} to={`/country/${c.slug}`} state={{ fly: true }}>
              {c.emoji} {c.name}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
