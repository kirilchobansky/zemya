/**
 * The quiz catalogue. Laid out from QUIZ_DEFINITIONS/QUIZ_SIZES
 * (app/lib/geography/quizzes.ts) so a new quiz is one entry in that registry, not a new
 * route tree. See CLAUDE.md's Quizzes section.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';

import { bestQuizTime, deleteQuizRun, listQuizRuns, type QuizRunEntry } from '~/lib/core/progress';
import { formatDuration } from '~/lib/format';
import { QUIZ_DEFINITIONS } from '~/lib/geography/quizzes';
import { poolForScope, QUIZ_SCOPES, SCOPE_LABELS, sizesForPool, type QuizScope, type QuizSize } from '~/lib/geography/scopes';
import { allCountries } from '~/lib/geography/catalog.server';
import type { Route } from './+types/quiz';

/** How many countries each scope holds, read from the shipped catalogue at build time —
 *  the size ladder is derived from these, so a country added to content/ moves it. */
export function loader() {
  const countries = allCountries();
  return Object.fromEntries(
    QUIZ_SCOPES.map(scope => [scope, poolForScope(countries, scope).length])
  ) as Record<QuizScope, number>;
}

export function meta() {
  return [
    { title: 'Quizzes — Zemya' },
    {
      name: 'description',
      content: 'Timed quizzes built from the same country catalogue as the atlas and study mode.'
    }
  ];
}

const bestKey = (quizId: string, scope: QuizScope, size: QuizSize) => `${quizId}:${scope}:${size}`;

export default function QuizCatalogue({ loaderData: scopeCounts }: Route.ComponentProps) {
  /** Chosen scope per quiz; every quiz block has its own chip row. */
  const [scopes, setScopes] = useState<Record<string, QuizScope>>({});
  const scopeOf = (quizId: string): QuizScope => scopes[quizId] ?? 'world';

  /** {quizId}:{scope}:{size} -> fastest recorded time, or null. Starts empty and fills in
   *  after mount — IndexedDB doesn't exist during prerender, so the first render (and its
   *  hydration match) simply shows no best times yet, same as a genuinely new browser. */
  const [bestTimes, setBestTimes] = useState<Record<string, number | null>>({});
  const [history, setHistory] = useState<{ quizId: string; scope: QuizScope; size: QuizSize } | null>(null);
  const [runs, setRuns] = useState<QuizRunEntry[]>([]);

  const refreshBestTimes = useCallback(async (quizId: string, scope: QuizScope) => {
    const entries = await Promise.all(
      sizesForPool(scopeCounts[scope]).map(
        async size => [bestKey(quizId, scope, size), await bestQuizTime(quizId, scope, size)] as const
      )
    );
    setBestTimes(prev => ({ ...prev, ...Object.fromEntries(entries) }));
  }, [scopeCounts]);

  useEffect(() => {
    for (const quiz of QUIZ_DEFINITIONS) refreshBestTimes(quiz.id, scopes[quiz.id] ?? 'world');
  }, [refreshBestTimes, scopes]);

  async function openHistory(quizId: string, scope: QuizScope, size: QuizSize) {
    setHistory({ quizId, scope, size });
    setRuns(await listQuizRuns(quizId, scope, size));
  }

  async function handleDelete(run: QuizRunEntry) {
    if (run.id === undefined || !history) return;
    if (!window.confirm(`Delete this run (${formatDuration(run.timeMs)})?`)) return;
    await deleteQuizRun(run.id);
    const { quizId, scope, size } = history;
    const [freshRuns, freshBest] = await Promise.all([
      listQuizRuns(quizId, scope, size),
      bestQuizTime(quizId, scope, size)
    ]);
    setRuns(freshRuns);
    setBestTimes(prev => ({ ...prev, [bestKey(quizId, scope, size)]: freshBest }));
  }

  return (
    <>
      <header className="panel__head panel__head--quiet">
        <span className="panel__eyebrow">Quizzes</span>
        <h2>Pick a quiz</h2>
      </header>
      <div className="panel__body">
        {QUIZ_DEFINITIONS.map(quiz => {
          const scope = scopeOf(quiz.id);
          const poolSize = scopeCounts[scope];
          return (
          <section key={quiz.id} className="quiz-block">
            <h3 className="quiz-title">{quiz.title}</h3>
            <p className="quiz-desc">{quiz.description}</p>

            <div className="chips quiz-scope" role="group" aria-label={`${quiz.title} — region`}>
              {QUIZ_SCOPES.map(option => (
                <button
                  key={option}
                  type="button"
                  className="chip"
                  aria-pressed={scope === option}
                  onClick={() => setScopes(prev => ({ ...prev, [quiz.id]: option }))}
                >
                  {SCOPE_LABELS[option]}
                </button>
              ))}
            </div>

            <div className="quiz-sizes">
              {sizesForPool(poolSize).map(size => {
                const best = bestTimes[bestKey(quiz.id, scope, size)];
                return (
                  <div key={size} className="quiz-size-card">
                    <Link className="quiz-size-card__link" to={`/quiz/${quiz.id}/${scope}/${size}`}>
                      <span className="quiz-size-card__n">{size === 'all' ? 'All' : size}</span>
                      <span className="quiz-size-card__label">
                        {size === 'all' ? `${poolSize} rounds` : 'rounds'}
                      </span>
                    </Link>
                    {best != null && (
                      <button
                        type="button"
                        className="quiz-size-card__best"
                        onClick={() => openHistory(quiz.id, scope, size)}
                      >
                        {formatDuration(best)}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {history?.quizId === quiz.id && history.scope === scope && (
              <div className="quiz-history">
                <div className="quiz-history__head">
                  <h4>{SCOPE_LABELS[history.scope]} · {history.size === 'all' ? 'All' : history.size} rounds — history</h4>
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
          );
        })}
      </div>
    </>
  );
}
