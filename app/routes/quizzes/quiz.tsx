/**
 * /quiz predates the subject layer (docs/quizzes.md); it was the geography quiz catalogue
 * and geography is still the only subject with quizzes, so old links and bookmarks land on
 * its equivalent, /quizzes/geography. Kept as a permanent redirect rather than removed — see
 * routes/quizzes.$subject.tsx for the real page.
 */
import { Link, Navigate } from 'react-router';

import { pageMeta } from '~/lib/seo';

/** A redirect page: canonical points at where it lands, and it stays out of the index. */
export function meta() {
  return pageMeta({
    title: 'Quizzes moved — Zemya',
    description: 'The quiz catalogue has moved.',
    path: '/quizzes/geography',
    noindex: true
  });
}

export default function LegacyQuizCatalogueRedirect() {
  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">Quizzes</span>
        <h2>Moved</h2>
      </header>
      <div className="panel__body">
        <Navigate to="/quizzes/geography" replace />
        <Link to="/quizzes/geography" className="action">Continue to the quizzes</Link>
      </div>
    </>
  );
}
