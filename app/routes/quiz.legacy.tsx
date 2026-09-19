/**
 * /quiz/:quizId/:size predates continent scopes; it now means the world scope. Kept as a
 * redirect so existing links and bookmarks don't break — see quiz.$quizId.tsx for the
 * real route (/quiz/:quizId/:scope/:size).
 */
import { Link, Navigate, useParams } from 'react-router';

export default function LegacyQuizRedirect() {
  const { quizId = '', size = '' } = useParams();
  const to = `/quiz/${quizId}/world/${size}`;
  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">Quiz</span>
        <h2>Moved</h2>
      </header>
      <div className="panel__body">
        <Navigate to={to} replace />
        <Link to={to} className="action">Continue to the quiz</Link>
      </div>
    </>
  );
}
