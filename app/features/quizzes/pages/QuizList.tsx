/**
 * The quiz list of one subject (geography's quizzes): each name expands inline into its scope
 * chips, size ladder and history, one quiz open at a time. Same markup on desktop's right
 * panel and the phone sheet (quiz-list.css handles the width difference).
 */
import { Link } from "react-router";

import { QUIZ_SCOPES, sizesForPool } from '~/features/countries';
import { subjectById } from '../engine/subjects';
import { quizCount } from '../engine/subjects';
import { QuizListItem } from './QuizListItem';
import { SIZE_COLUMNS, type PoolCounts } from './quiz-list-data';
import { useQuizList } from './use-quiz-list';
import '~/features/quizzes/engine/quiz-list.css';
import '~/features/quizzes/engine/quiz-list.phone.css';

export function QuizList({ subjectId, scopeCounts }: { subjectId: string | undefined; scopeCounts: PoolCounts }) {
  const subject = subjectId ? subjectById(subjectId) : undefined;

  /** Rows in the tallest size grid any scope can produce — every quiz's grid reserves this
   *  much height, so choosing a smaller scope never moves the quiz below it. */
  const maxRows = Math.max(
    1,
    ...Object.values(scopeCounts).flatMap((counts) =>
      QUIZ_SCOPES.map((scope) =>
        Math.ceil(sizesForPool(counts[scope]).length / SIZE_COLUMNS),
      ),
    ),
  );
  const list = useQuizList(scopeCounts, Boolean(subject));
  const {
    openId, setOpenId, scopeOf, setScopes, selectionModeOf, setSelectionModes,
    bestTimes, history, setHistory, runs, openHistory, handleDelete
  } = list;

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
            <p>There is no subject called "{subjectId}".</p>
          </div>
          <Link to="/quizzes" className="action">
            Back to subjects
          </Link>
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
              Timed rounds, one tap to start
            </div>
          </div>
        </div>
      </header>
      <div className="panel__body">
        {quizCount(subject) === 0 ? (
          <div className="empty">
            <div className="empty__icon">🕓</div>
            <p>There are no {subject.name} quizzes yet.</p>
            <Link to="/quizzes" className="action">
              Back to subjects
            </Link>
          </div>
        ) : (
          <div className="quiz-list">
            {/* "Name all countries" is geography's one quiz that is not a QuizDefinition */}
            {[...subject.quizzes, ...(subject.extraQuizzes ?? [])].map((quiz) => {
              const scope = scopeOf(quiz.id);
              return (
                <QuizListItem
                  key={quiz.id}
                  quiz={quiz}
                  subjectId={subject.id}
                  open={openId === quiz.id}
                  scope={scope}
                  selectionMode={selectionModeOf(quiz.id)}
                  poolSize={scopeCounts[quiz.id][scope]}
                  maxRows={maxRows}
                  bestTimes={bestTimes}
                  history={history}
                  runs={runs}
                  onToggle={() => setOpenId(openId === quiz.id ? null : quiz.id)}
                  onScope={(option) => setScopes((prev) => ({ ...prev, [quiz.id]: option }))}
                  onSelectionMode={() => {
                    setHistory(null); // the archive is per mode: close the one that is open
                    setSelectionModes((prev) => ({
                      ...prev,
                      [quiz.id]: selectionModeOf(quiz.id) === "random" ? "population" : "random",
                    }));
                  }}
                  onOpenHistory={() => openHistory(quiz.id, scope, selectionModeOf(quiz.id))}
                  onCloseHistory={() => setHistory(null)}
                  onDeleteRun={handleDelete}
                />
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
