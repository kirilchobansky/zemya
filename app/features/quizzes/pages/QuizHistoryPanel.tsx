import { SCOPE_LABELS, type QuizScope, type QuizSize } from '~/features/countries';
import type { QuizRunEntry } from '~/features/progress';
import { formatDuration } from "~/shared/lib/format";
import { NAME_ALL_ID } from '../geography/quizzes';
import { formatRunDate } from './quiz-list-data';

/** The run history of one quiz/scope/size: date, time and tally per run, each deletable. */
export function QuizHistoryPanel({ history, runs, onClose, onDelete }: {
  history: { quizId: string; scope: QuizScope; size: QuizSize };
  runs: QuizRunEntry[];
  onClose: () => void;
  onDelete: (run: QuizRunEntry) => void;
}) {
  return (
    <div className="quiz-history">
      <div className="quiz-history__head">
        <h4>
          {SCOPE_LABELS[history.scope]} ·{" "}
          {history.quizId === NAME_ALL_ID
            ? "name all"
            : `${history.size === "all" ? "All" : history.size} rounds`}{" "}
          — history
        </h4>
        <button
          type="button"
          className="quiz-history__close"
          onClick={onClose}
          aria-label="Close history"
        >
          ×
        </button>
      </div>
      {runs.length === 0 ? (
        <p className="quiz-history__empty">
          No runs left.
        </p>
      ) : (
        <ul className="quiz-history__list">
          {runs.map((run) => (
            <li
              key={run.id}
              className="quiz-history__row"
            >
              <span className="quiz-history__date">
                {formatRunDate(run.at)}
              </span>
              <span className="quiz-history__time numeric">
                {formatDuration(run.timeMs)}
              </span>
              <span className="quiz-history__tally">
                {run.firstTryCount}/{run.totalCount}{" "}
                {history.quizId === NAME_ALL_ID ? "named" : "first-try"}
              </span>
              <button
                type="button"
                className="quiz-history__delete"
                onClick={() => onDelete(run)}
                aria-label="Delete this run"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
