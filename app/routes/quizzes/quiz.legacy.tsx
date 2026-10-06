/**
 * /quiz/:quizId/:size predates both continent scopes and the subject layer; it now means the
 * world scope of a geography quiz. Kept as a redirect so existing links and bookmarks don't
 * break — see routes/quizzes.$subject.$quizId.tsx for the real route
 * (/quizzes/:subject/:quizId/:scope/:size).
 */
import { Link, Navigate, useParams } from 'react-router';

import { pageMeta } from '~/lib/seo';
import type { Route } from './+types/quiz.legacy';

/** A redirect page: canonical points at where it lands, and it stays out of the index. */
export function meta({ params }: Route.MetaArgs) {
  return pageMeta({
    title: 'Quiz moved — Zemya',
    description: 'This quiz has moved.',
    path: `/quizzes/geography/${params.quizId}/world/${params.size}`,
    noindex: true
  });
}

export default function LegacyQuizRedirect() {
  const { quizId = '', size = '' } = useParams();
  const to = `/quizzes/geography/${quizId}/world/${size}`;
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
