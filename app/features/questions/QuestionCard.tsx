import type { Question } from '~/features/progress';
import type { CountryRecord } from '~/engines/map/types';
import { Flag } from '~/shared/components/Flag';
import type { Answer } from './use-question-session';

/** One question: progress bar, prompt, options, hint, and — once answered — the note and memory hook. */
export function QuestionCard({ question, index, total, answer, eliminated, hintUsed, promptCountry, onChoose, onHint, onNext }: {
  question: Question;
  index: number;
  total: number;
  answer: Answer | null;
  eliminated: number | null;
  hintUsed: boolean;
  promptCountry: CountryRecord | null;
  onChoose: (index: number) => void;
  onHint: () => void;
  onNext: () => void;
}) {
  const pct = Math.round((index / total) * 100);

  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">Questions</span>
        <h2>
          {index + 1} / {total}
        </h2>
      </header>

      <div className="panel__body">
        <div className="quiz__bar">
          <div className="quiz__bar-fill" style={{ width: `${pct}%` }} />
        </div>

        {question.promptFlag ? (
          <div className="quiz__prompt-flag">
            <Flag
              iso2={question.promptFlag}
              emoji={promptCountry?.emoji ?? ''}
              flagRatio={promptCountry?.flagRatio ?? 4 / 3}
              size="lg"
            />
          </div>
        ) : (
          <p className="quiz__prompt">{question.prompt}</p>
        )}

        <div className="quiz__options">
          {question.options.map((option, i) => {
            const state = answer
              ? i === question.answerIndex
                ? 'correct'
                : i === answer.chosenIndex
                  ? 'wrong'
                  : undefined
              : i === eliminated
                ? 'eliminated'
                : undefined;
            return (
              <button
                key={option}
                type="button"
                className="quiz__option"
                data-state={state}
                disabled={Boolean(answer) || i === eliminated}
                onClick={() => onChoose(i)}
              >
                <span className="quiz__option-key">{i + 1}</span>
                {option}
              </button>
            );
          })}
        </div>

        {!answer && (
          <button type="button" className="action" disabled={hintUsed} onClick={onHint}>
            Hint
          </button>
        )}

        {answer && (
          <>
            {question.note && <p className="quiz__note">{question.note}</p>}
            <div className="hook">
              <div className="hook__label">Memory hook</div>
              {/* Hooks are authored as fragments with an implied subject (see
                  CLAUDE.md's Content conventions) — right under the dossier's own
                  heading that's fine, but here the question could have been about any
                  country, so the subject has to be supplied. */}
              <p>
                <b>{promptCountry?.name}</b> — {question.hook}
              </p>
            </div>
            <button type="button" className="action action--primary" onClick={onNext}>
              Next
            </button>
          </>
        )}
      </div>
    </>
  );
}
