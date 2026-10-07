import { Link } from "react-router";
import type { CSSProperties } from 'react';

import { SCOPE_LABELS, QUIZ_SCOPES, sizesForPool, type QuizScope, type QuizSize } from '~/features/countries';
import type { QuizRunEntry } from '~/features/progress';
import { formatDuration } from "~/shared/lib/format";
import { NAME_ALL_ID, type QuizSelectionMode } from '../geography/quizzes';
import type { QuizDefinition } from '../engine/types';
import { QuizHistoryPanel } from './QuizHistoryPanel';
import { SIZE_COLUMNS, bestKey } from './quiz-list-data';

/** One quiz of the list: the row, and — when open — its scope chips, order toggle, size ladder
 *  and archive. */
export function QuizListItem({
  quiz, subjectId, open, scope, selectionMode, poolSize, maxRows, bestTimes, history, runs,
  onToggle, onScope, onSelectionMode, onOpenHistory, onCloseHistory, onDeleteRun
}: {
  quiz: Pick<QuizDefinition, 'id' | 'title' | 'description'>;
  subjectId: string;
  open: boolean;
  scope: QuizScope;
  selectionMode: QuizSelectionMode;
  poolSize: number;
  maxRows: number;
  bestTimes: Record<string, number | null>;
  history: { quizId: string; scope: QuizScope; mode: QuizSelectionMode } | null;
  runs: QuizRunEntry[];
  onToggle: () => void;
  onScope: (scope: QuizScope) => void;
  onSelectionMode: () => void;
  onOpenHistory: () => void;
  onCloseHistory: () => void;
  onDeleteRun: (run: QuizRunEntry) => void;
}) {
  const nameAll = quiz.id === NAME_ALL_ID;
  return (
    <section data-quiz-id={quiz.id} className="quiz-list__item">
      <button
        type="button"
        className="quiz-list__row"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="quiz-list__name">{quiz.title}</span>
        <span className="quiz-list__chevron" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="quiz-list__body">
          <p className="quiz-desc">{quiz.description}</p>

          <div
            className="chips quiz-scope"
            role="group"
            aria-label={`${quiz.title} — region`}
          >
            {QUIZ_SCOPES.map((option) => (
              <button
                key={option}
                type="button"
                className="chip"
                aria-pressed={scope === option}
                onClick={() => onScope(option)}
              >
                {SCOPE_LABELS[option]}
              </button>
            ))}
          </div>

          {!nameAll && (
          <div
            className="chips quiz-order"
            role="group"
            aria-label={`${quiz.title} — country order`}
          >
            <button
              type="button"
              className="chip"
              aria-pressed={selectionMode === "population"}
              onClick={onSelectionMode}
            >
              {selectionMode === "random" ? "Random" : "Population"}
            </button>
          </div>
          )}

          <div
            className="quiz-sizes"
            style={
              {
                "--cols": SIZE_COLUMNS,
                "--max-rows": maxRows,
              } as CSSProperties
            }
          >
            {(nameAll ? (["all"] as QuizSize[]) : sizesForPool(poolSize)).map((size) => {
              // each category's best: only perfect runs of this same size (and mode) compete
              const best = bestTimes[bestKey(quiz.id, scope, size, selectionMode)];
              return (
                <div key={size} className="quiz-size-card">
                  <Link
                    className="quiz-size-card__link"
                    to={`/quizzes/${subjectId}/${quiz.id}/${scope}/${size}${!nameAll && selectionMode === "population" ? "?order=population" : ""}`}
                  >
                    <span className="quiz-size-card__n">
                      {size === "all" ? "All" : size}
                    </span>
                    <span className="quiz-size-card__label">
                      {nameAll
                        ? `${poolSize} countries`
                        : size === "all"
                          ? `${poolSize} rounds`
                          : "rounds"}
                    </span>
                  </Link>
                  {best != null && (
                    <button type="button" className="quiz-size-card__best" onClick={onOpenHistory}>
                      {formatDuration(best)}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="chips quiz-archive" role="group" aria-label={`${quiz.title} — archive`}>
            <button
              type="button"
              className="chip"
              aria-pressed={history?.quizId === quiz.id}
              onClick={() => (history?.quizId === quiz.id ? onCloseHistory() : onOpenHistory())}
            >
              Archive
            </button>
          </div>

          {history?.quizId === quiz.id && history.scope === scope && (
            <QuizHistoryPanel history={history} runs={runs} onClose={onCloseHistory} onDelete={onDeleteRun} />
          )}
        </div>
      )}
    </section>
  );
}
