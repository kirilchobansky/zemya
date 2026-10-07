import { SCOPE_LABELS, type QuizScope } from '~/features/countries';
import type { QuizRunEntry } from '~/features/progress';
import { formatDuration } from "~/shared/lib/format";
import { NAME_ALL_ID } from '../geography/quizzes';
import { formatRunDate } from './quiz-list-data';
import './QuizHistoryPanel.css';

/** "first try", "second try", "third try", then "4th try", "5th try", ... */
function tryLabel(n: number): string {
  return `${['first', 'second', 'third'][n - 1] ?? `${n}th`} try`;
}

/** The tally of a run: countries known after its LAST finished attempt, out of the total — the
 *  first run counts first-try answers, each review pass then clears whatever it got right. */
function tally(run: QuizRunEntry): string {
  const passes = run.reviewMissedCounts?.length ?? 0;
  const known = passes ? run.totalCount - run.reviewMissedCounts![passes - 1] : run.firstTryCount;
  return `${known}/${run.totalCount} ${tryLabel(passes + 1)}`;
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
              <span
                className="quiz-history__tally"
                title={run.reviewTimesMs?.map((ms) => formatDuration(ms)).join(" · ")}
              >
                {history.quizId === NAME_ALL_ID
                  ? `${run.firstTryCount}/${run.totalCount} named`
                  : tally(run)}
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
