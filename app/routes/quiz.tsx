/**
 * The quiz catalogue. Today there is one quiz — "Name the Country" — laid out from
 * QUIZZES/QUIZ_SIZES (app/lib/geography/quizzes.ts) so a future quiz is a new entry in
 * that list, not a new route tree. See CLAUDE.md's Quizzes section.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { bestQuizTime } from '~/lib/core/progress';
import { formatDuration } from '~/lib/format';
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
  /** {quizId}:{size} -> fastest recorded time, or null. Starts empty and fills in after
   *  mount — IndexedDB doesn't exist during prerender, so the first render (and its
   *  hydration match) simply shows no best times yet, same as a genuinely new browser. */
  const [bestTimes, setBestTimes] = useState<Record<string, number | null>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      QUIZZES.flatMap(quiz =>
        QUIZ_SIZES.map(async size => [`${quiz.id}:${size}`, await bestQuizTime(quiz.id, size)] as const)
      )
    ).then(entries => {
      if (!cancelled) setBestTimes(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, []);

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
              {QUIZ_SIZES.map(size => {
                const best = bestTimes[`${quiz.id}:${size}`];
                return (
                  <Link key={size} className="quiz-size-card" to={`/quiz/${quiz.id}/${size}`}>
                    <span className="quiz-size-card__n">{size === 'all' ? 'All' : size}</span>
                    <span className="quiz-size-card__label">countries</span>
                    {best != null && <span className="quiz-size-card__best">{formatDuration(best)}</span>}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
