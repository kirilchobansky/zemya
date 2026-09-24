/**
 * The subject picker — the new top of the quiz tree. /quizzes/:subject lists that subject's
 * quizzes (routes/quizzes.$subject.tsx); a run is /quizzes/:subject/:quizId/:scope/:size
 * (routes/quizzes.$subject.$quizId.tsx). See docs/quizzes.md's "Route shape".
 */
import { Link } from 'react-router';

import { pageMeta } from '~/lib/seo';
import { SUBJECTS } from '~/lib/quiz/subjects';

export function meta() {
  return pageMeta({
    title: 'Quizzes — Zemya',
    description: 'Pick a subject to see its timed quizzes.',
    path: '/quizzes'
  });
}

export default function SubjectPicker() {
  return (
    <>
      <header className="panel__head panel__head--quiet panel__head--peek">
        <span className="panel__eyebrow">Quizzes</span>
        <h2>Pick a subject</h2>
        {/* phone layout only: the sheet's lowest snap point */}
        <div className="peek">
          <div className="peek__text">
            <div className="peek__title">Quizzes</div>
            <div className="peek__sub">Pick a subject to see its timed quizzes</div>
          </div>
        </div>
      </header>
      <div className="panel__body">
        <div className="subject-list">
          {SUBJECTS.map(subject => (
            <Link key={subject.id} to={`/quizzes/${subject.id}`} className="subject-card">
              <span className="subject-card__name">
                <span aria-hidden="true">{subject.icon}</span> {subject.name}
              </span>
              <span className="subject-card__blurb">{subject.blurb}</span>
              <span className="subject-card__count">
                {subject.quizzes.length === 0
                  ? 'Coming soon'
                  : `${subject.quizzes.length} ${subject.quizzes.length === 1 ? 'quiz' : 'quizzes'}`}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
