/**
 * /quiz/:quizId/:scope/:size predates the subject layer (docs/quizzes.md); every quiz that
 * ever lived here belongs to geography, the only subject with quizzes today, so old links and
 * bookmarks land on their equivalent under /quizzes/geography. Kept as a permanent redirect
 * rather than removed — see routes/quizzes.$subject.$quizId.tsx for the real run route
 * (which still resolves a legacy scope key like "americas" on top of this).
 */
import { Link, Navigate, useParams } from 'react-router';

import { pageMeta } from '~/lib/seo';
import type { Route } from './+types/quiz.$quizId';

/** A redirect page: canonical points at where it lands, and it stays out of the index. */
export function meta({ params }: Route.MetaArgs) {
  return pageMeta({
    title: 'Quiz moved — Zemya',
    description: 'This quiz has moved.',
    path: `/quizzes/geography/${params.quizId}/${params.scope}/${params.size}`,
    noindex: true
  });
}

export default function LegacyQuizRunRedirect() {
  const { quizId = '', scope = '', size = '' } = useParams();
  const to = `/quizzes/geography/${quizId}/${scope}/${size}`;
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
