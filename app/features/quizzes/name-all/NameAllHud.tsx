import { Link } from 'react-router';

import { keepFocus } from '~/features/quizzes/engine/QuizControls';
import { PauseIcon } from '~/features/quizzes/engine/PauseIcon';
import { formatDuration } from '~/shared/lib/format';
import type { Phase } from './name-all-types';

/** The phone layout's HUD and pause screen (`display: none` above the breakpoint). The caller
 *  portals it to <body>: the panel is a transformed sheet, which would trap `position: fixed`. */
export function NameAllHud({ phase, paused, finished, backTo, total, namedCount, elapsedMs, onLeave, onTogglePause, onRestart, onGiveUp }: {
  phase: Phase;
  paused: boolean;
  finished: boolean;
  backTo: string;
  total: number;
  namedCount: number;
  elapsedMs: number;
  onLeave: () => void;
  onTogglePause: () => void;
  onRestart: () => void;
  onGiveUp: () => void;
}) {
  const hudCount = <span className="quiz-hud__count numeric">{namedCount} / {total}</span>;
  return (
    <>
      {!finished && (
        <div className="quiz-hud" data-phase={phase}>
          {phase === 'idle' ? (
            <>
              <Link to={backTo} state={{ sheet: 'full' }} replace className="quiz-hud__back">‹ Back</Link>
              <span className="quiz-hud__count numeric">{total} countries</span>
            </>
          ) : (
            <>
              <button type="button" className="quiz-hud__back" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={onLeave}>
                ‹ Back
              </button>
              <span className="quiz-hud__timer numeric">{formatDuration(elapsedMs)}</span>
              {hudCount}
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
      )}
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
