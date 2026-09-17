/**
 * The quiz catalogue. Today there is one quiz — "Name the Country" — laid out from
 * QUIZZES/QUIZ_SIZES (app/lib/geography/quizzes.ts) so a future quiz is a new entry in
 * that list, not a new route tree. See CLAUDE.md's Quizzes section.
 */
import { Link } from 'react-router';

import { QUIZ_SIZES, QUIZZES } from '~/lib/geography/quizzes';

export function meta() {
  return [
    { title: 'Quizzes — Zemya' },
    {
      name: 'description',
      content: 'Timed quizzes built from the same country catalogue as the atlas and study mode.'
    }
  ];
}

export default function QuizCatalogue() {
  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">Quizzes</span>
        <h2>Pick a quiz</h2>
      </header>
      <div className="panel__body">
        {QUIZZES.map(quiz => (
          <section key={quiz.id}>
            <h3 className="subhead">{quiz.title}</h3>
            <p style={{ color: 'var(--ink-2)', fontSize: 12.5, lineHeight: 1.5, margin: '0 0 10px' }}>
              {quiz.description}
            </p>
            <div className="quiz-sizes">
              {QUIZ_SIZES.map(size => (
                <Link key={size} className="quiz-size-card" to={`/quiz/${quiz.id}/${size}`}>
                  <span className="quiz-size-card__n">{size === 'all' ? 'All' : size}</span>
                  <span className="quiz-size-card__label">countries</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
