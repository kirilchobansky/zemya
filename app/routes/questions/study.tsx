/**
 * /study is Questions' old name (routes/questions.tsx) — kept as a permanent redirect so
 * existing links and bookmarks still land somewhere real. Same pattern as routes/quiz.tsx's
 * redirect from the pre-subject-layer quiz catalogue.
 */
import { Link, Navigate } from 'react-router';

import { pageMeta } from '~/lib/seo';

/** A redirect page: canonical points at where it lands, and it stays out of the index. */
export function meta() {
  return pageMeta({
    title: 'Questions — Zemya',
    description: 'Study has moved.',
    path: '/questions',
    noindex: true
  });
}

export default function LegacyStudyRedirect() {
  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">Questions</span>
        <h2>Moved</h2>
      </header>
      <div className="panel__body">
        <Navigate to="/questions" replace />
        <Link to="/questions" className="action">Continue to Questions</Link>
      </div>
    </>
  );
}
