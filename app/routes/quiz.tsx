/**
 * The quiz catalogue. Today there is one quiz — "Name the Country" — laid out from
 * QUIZZES/QUIZ_SIZES (app/lib/geography/quizzes.ts) so a future quiz is a new entry in
 * that list, not a new route tree. See CLAUDE.md's Quizzes section.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';

import { bestQuizTime, deleteQuizRun, listQuizRuns, type QuizRunEntry } from '~/lib/core/progress';
import { formatDuration } from '~/lib/format';
import { QUIZ_SIZES, QUIZZES, type QuizSize } from '~/lib/geography/quizzes';

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
  const [history, setHistory] = useState<{ quizId: string; size: QuizSize } | null>(null);
  const [runs, setRuns] = useState<QuizRunEntry[]>([]);

  const refreshBestTimes = useCallback(async () => {
    const entries = await Promise.all(
      QUIZZES.flatMap(quiz =>
        QUIZ_SIZES.map(async size => [`${quiz.id}:${size}`, await bestQuizTime(quiz.id, size)] as const)
      )
    );
    setBestTimes(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    refreshBestTimes();
  }, [refreshBestTimes]);

  async function openHistory(quizId: string, size: QuizSize) {
    setHistory({ quizId, size });
    setRuns(await listQuizRuns(quizId, size));
  }

  async function handleDelete(run: QuizRunEntry) {
    if (run.id === undefined || !history) return;
    if (!window.confirm(`Delete this run (${formatDuration(run.timeMs)})?`)) return;
    await deleteQuizRun(run.id);
    const [freshRuns, freshBest] = await Promise.all([
      listQuizRuns(history.quizId, history.size),
      bestQuizTime(history.quizId, history.size)
    ]);
    setRuns(freshRuns);
    setBestTimes(prev => ({ ...prev, [`${history.quizId}:${history.size}`]: freshBest }));
  }

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
                  <div key={size} className="quiz-size-card">
                    <Link className="quiz-size-card__link" to={`/quiz/${quiz.id}/${size}`}>
                      <span className="quiz-size-card__n">{size === 'all' ? 'All' : size}</span>
                      <span className="quiz-size-card__label">countries</span>
                    </Link>
                    {best != null && (
                      <button
                        type="button"
                        className="quiz-size-card__best"
                        onClick={() => openHistory(quiz.id, size)}
                      >
                        {formatDuration(best)}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {history?.quizId === quiz.id && (
              <div className="quiz-history">
                <div className="quiz-history__head">
                  <h4>{history.size === 'all' ? 'All' : history.size} countries — history</h4>
                  <button
                    type="button"
                    className="quiz-history__close"
                    onClick={() => setHistory(null)}
                    aria-label="Close history"
                  >
                    ×
                  </button>
                </div>
                {runs.length === 0 ? (
                  <p className="quiz-history__empty">No runs left.</p>
                ) : (
                  <ul className="quiz-history__list">
                    {runs.map(run => (
                      <li key={run.id} className="quiz-history__row">
                        <span className="quiz-history__date">{new Date(run.at).toLocaleDateString()}</span>
                        <span className="quiz-history__time numeric">{formatDuration(run.timeMs)}</span>
                        <span className="quiz-history__tally">
                          {run.firstTryCount}/{run.totalCount} first-try
                        </span>
                        <button
                          type="button"
                          className="quiz-history__delete"
                          onClick={() => handleDelete(run)}
                          aria-label="Delete this run"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
