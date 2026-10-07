
import { formatDuration } from '~/shared/lib/format';
import type { FillQuiz } from './fill-quiz';
import type { Outcome, Phase } from './fill-run-types';

/** The result card of a finished or given-up run: time, count, personal-best line. */
export function FillResultCard({ quiz, phase, runToggle, elapsedMs, filledCount, total, missed, outcome }: {
  quiz: FillQuiz;
  phase: Phase;
  runToggle: boolean;
  elapsedMs: number;
  filledCount: number;
  total: number;
  missed: number;
  outcome: Outcome | null;
}) {
  return (
    <div className="hook">
      <div className="hook__label">
        {phase === 'done' ? 'Result' : 'Gave up'}
        {quiz.toggle && runToggle && <> · {quiz.toggle.label.toLowerCase()}</>}
      </div>
      <p className="quiz-result__time numeric">{formatDuration(elapsedMs)}</p>
      <p style={{ marginBottom: 0 }}>
        <b>{filledCount} / {total}</b> filled
        {phase === 'gaveup' && <> — {missed} shown in red</>}.{' '}
        {phase === 'done' && outcome && (
          outcome.beatBest
            ? outcome.previousBest !== null
              ? <>New personal best — beat <b>{formatDuration(outcome.previousBest)}</b>.</>
              : <>First run of this list — now your personal best.</>
            : <>Personal best stays <b>{formatDuration(outcome.previousBest ?? outcome.timeMs)}</b>.</>
        )}
        {phase === 'gaveup' && <>A given-up run is not saved.</>}
      </p>
    </div>
  );
}

/** "Try again" only: leaving is the Back button at the top (the phone HUD's, or the panel's). */
export function FillResultButtons({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="actions">
      <button type="button" className="action action--primary" onClick={onRestart}>Try again</button>
    </div>
  );
}
