import { keepFocus } from '~/features/quizzes/engine/QuizControls';
import { PauseIcon } from '~/features/quizzes/engine/PauseIcon';
import { formatDuration } from '~/shared/lib/format';
import type { Phase } from './fill-run-types';

/** The phone layout's furniture (`display: none` above the breakpoint): the geography run's
 *  HUD and pause screen, reused. The caller portals it to <body>, like that run's. */
export function FillPhoneHud({ phase, paused, total, filledCount, elapsedMs, onLeave, onTogglePause, onRestart, onGiveUp }: {
  phase: Phase;
  paused: boolean;
  total: number;
  filledCount: number;
  elapsedMs: number;
  onLeave: () => void;
  onTogglePause: () => void;
  onRestart: () => void;
  onGiveUp: () => void;
}) {
  return (
    <>
    <div className="quiz-hud" data-phase={`fill-${phase}`}>
      <button type="button" className="quiz-hud__back" onClick={onLeave}>‹ Quizzes</button>
      {phase === 'idle' && <span className="quiz-hud__count quiz-hud__count--end numeric">{total} entries</span>}
      {phase === 'running' && (
        <>
          <span className="quiz-hud__timer numeric">{formatDuration(elapsedMs)}</span>
          <span className="quiz-hud__count numeric">{filledCount} / {total}</span>
          <button
            type="button"
            className="quiz-hud__pause"
            aria-label={paused ? 'Resume' : 'Pause'}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={onTogglePause}
          >
            <PauseIcon />
          </button>
        </>
      )}
    </div>
    {paused && (
      <div className="quiz-pause" role="dialog" aria-label="Paused">
        <p className="quiz-pause__title">Paused</p>
        <p className="quiz-pause__sub">The timer is stopped.</p>
        <button type="button" className="quiz-pause__btn quiz-pause__btn--primary" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={onTogglePause}>
          Resume
        </button>
        <button type="button" className="quiz-pause__btn" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={onRestart}>
          Restart
        </button>
        <button type="button" className="quiz-pause__btn" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={onGiveUp}>
          Give up
        </button>
        <button type="button" className="quiz-pause__btn" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={onLeave}>
          Abandon run
        </button>
      </div>
    )}
    </>
  );
}
