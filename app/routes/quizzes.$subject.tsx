/**
 * The quiz list for one subject — geography's three quizzes today, history empty. Listed
 * compact (name only); clicking a name expands its scope chips, size ladder and history
 * inline, one quiz open at a time. Same markup on desktop's right panel and the phone sheet
 * (app.css handles the width difference). See CLAUDE.md's Quizzes section and
 * docs/quizzes.md's "Route shape".
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';

import { bestQuizTime, deleteQuizRun, listQuizRuns, type QuizRunEntry } from '~/lib/core/progress';
import { formatDuration } from '~/lib/format';
import { pageMeta } from '~/lib/seo';
import { subjectById } from '~/lib/quiz/subjects';
import { poolForScope, QUIZ_SCOPES, SCOPE_LABELS, sizesForPool, type QuizScope, type QuizSize } from '~/lib/geography/scopes';
import { allCountries } from '~/lib/geography/catalog.server';
import { peekWorld } from '~/lib/geography/world';
import type { Route } from './+types/quizzes.$subject';

/** How many countries each scope holds, read from the shipped catalogue at build time —
 *  the size ladder is derived from these. Unused by a subject with no quizzes (history). */
export function loader() {
  const countries = allCountries();
  return Object.fromEntries(
    QUIZ_SCOPES.map(scope => [scope, poolForScope(countries, scope).length])
  ) as Record<QuizScope, number>;
}

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  const world = peekWorld();
  if (!world) return serverLoader();
  return Object.fromEntries(
    QUIZ_SCOPES.map(scope => [scope, poolForScope(world.data.countries, scope).length])
  ) as Record<QuizScope, number>;
}

export function meta({ params }: Route.MetaArgs) {
  const subject = params.subject ? subjectById(params.subject) : undefined;
  if (!subject) {
    return pageMeta({ title: 'Quizzes — Zemya', description: 'No such subject.', path: `/quizzes/${params.subject}`, noindex: true });
  }
  return pageMeta({
    title: `${subject.name} Quizzes — Zemya`,
    description: subject.quizzes.length
      ? `Timed ${subject.name.toLowerCase()} quizzes: ${subject.quizzes.map(q => q.title).join(', ')}.`
      : `${subject.name} quizzes are coming to Zemya.`,
    path: `/quizzes/${subject.id}`
  });
}

const bestKey = (quizId: string, scope: QuizScope, size: QuizSize) => `${quizId}:${scope}:${size}`;

/** Must match .quiz-sizes' column count in app.css — passed in as --cols so the CSS
 *  min-height and this row count are computed from the same number. */
const SIZE_COLUMNS = 3;

export default function QuizList({ params, loaderData: scopeCounts }: Route.ComponentProps) {
  const subject = params.subject ? subjectById(params.subject) : undefined;

  /** Rows in the tallest size grid any scope can produce — every quiz's grid reserves this
   *  much height, so choosing a smaller scope never moves the quiz below it. */
  const maxRows = Math.max(
    ...QUIZ_SCOPES.map(scope => Math.ceil(sizesForPool(scopeCounts[scope]).length / SIZE_COLUMNS))
  );
  /** Which quiz's options are expanded — one at a time, collapsed by default. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** Chosen scope per quiz; every quiz keeps its own chip row across collapses. */
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
    if (!openId || !subject) return;
    refreshBestTimes(openId, scopes[openId] ?? 'world');
  }, [refreshBestTimes, scopes, openId, subject]);

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

  if (!subject) {
    return (
      <>
        <header className="panel__head">
          <span className="panel__eyebrow">Quizzes</span>
          <h2>Not found</h2>
        </header>
        <div className="panel__body">
          <div className="empty">
            <div className="empty__icon">?</div>
            <p>There is no subject called "{params.subject}".</p>
          </div>
          <Link to="/quizzes" className="action">Back to subjects</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="panel__head panel__head--quiet panel__head--peek">
        <span className="panel__eyebrow">
          <Link to="/quizzes">Quizzes</Link> · {subject.name}
        </span>
        <h2>Pick a quiz</h2>
        {/* phone layout only: the sheet's lowest snap point */}
        <div className="peek">
          <div className="peek__text">
            <div className="peek__title">{subject.name}</div>
            <div className="peek__sub">
              {subject.quizzes.length ? 'Timed rounds, one tap to start' : 'Coming soon'}
            </div>
          </div>
        </div>
      </header>
      <div className="panel__body">
        {subject.quizzes.length === 0 ? (
          <div className="empty">
            <div className="empty__icon">🕓</div>
            <p>{subject.name} quizzes are coming soon.</p>
            <Link to="/quizzes" className="action">Back to subjects</Link>
          </div>
        ) : (
          <div className="quiz-list">
            {subject.quizzes.map(quiz => {
              const open = openId === quiz.id;
              const scope = scopeOf(quiz.id);
              const poolSize = scopeCounts[scope];
              return (
                <section key={quiz.id} className="quiz-list__item">
                  <button
                    type="button"
                    className="quiz-list__row"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : quiz.id)}
                  >
                    <span className="quiz-list__name">{quiz.title}</span>
                    <span className="quiz-list__chevron" aria-hidden="true">{open ? '−' : '+'}</span>
                  </button>

                  {open && (
                    <div className="quiz-list__body">
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

                      <div
                        className="quiz-sizes"
                        style={{ '--cols': SIZE_COLUMNS, '--max-rows': maxRows } as CSSProperties}
                      >
                        {sizesForPool(poolSize).map(size => {
                          const best = bestTimes[bestKey(quiz.id, scope, size)];
                          return (
                            <div key={size} className="quiz-size-card">
                              <Link
                                className="quiz-size-card__link"
                                to={`/quizzes/${subject.id}/${quiz.id}/${scope}/${size}`}
                              >
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
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
