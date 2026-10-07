import { SCOPE_LABELS, type QuizScope } from '~/features/countries';
import type { QuizRunEntry } from '~/features/progress';
import { formatDuration } from "~/shared/lib/format";
import { NAME_ALL_ID } from '../geography/quizzes';
import { formatRunDate } from './quiz-list-data';
import './QuizHistoryPanel.css';

/** "Second time", "Third time", then "4th time", "5th time", ... */
function timeLabel(n: number): string {
  return `${n === 2 ? 'Second' : n === 3 ? 'Third' : `${n}th`} time`;
}

/** The archive of one quiz/scope (and selection mode), every size together: date, size, time and
 *  tally per run, each deletable. */
export function QuizHistoryPanel({ history, runs, onClose, onDelete }: {
  history: { quizId: string; scope: QuizScope; mode: string };
  runs: QuizRunEntry[];
  onClose: () => void;
  onDelete: (run: QuizRunEntry) => void;
}) {
  return (
    <div className="quiz-history">
      <div className="quiz-history__head">
        <h4>
          {SCOPE_LABELS[history.scope]} ·{" "}
          {history.quizId === NAME_ALL_ID ? "name all" : history.mode} — archive
        </h4>
        <button
          type="button"
          className="quiz-history__close"
          onClick={onClose}
          aria-label="Close archive"
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
              {history.quizId !== NAME_ALL_ID && (
                <span className="quiz-history__size">
                  {run.size === "all" ? "All" : `Top ${run.size}`}
                </span>
              )}
              <span className="quiz-history__time numeric">
                {formatDuration(run.timeMs)}
              </span>
              {run.reviewTimesMs?.map((ms, i) => (
                <span key={i} className="quiz-history__retry numeric">
                  <span className="quiz-history__ordinal">{timeLabel(i + 2)}</span> {formatDuration(ms)}
                </span>
              ))}
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
