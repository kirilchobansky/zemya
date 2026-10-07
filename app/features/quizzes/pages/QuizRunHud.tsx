import { Link } from "react-router";

import { formatDuration } from "~/shared/lib/format";
import type { QuizEngine } from '../engine/engine';
import { keepFocus } from '../engine/QuizControls';
import { PauseIcon } from '../engine/PauseIcon';

/** The phone layout's run chrome (`display: none` above the breakpoint): a thin HUD on top and
 *  the pause screen with Resume, Restart and Abandon. The caller portals it to <body> — the
 *  panel is a transformed sheet, which would trap `position: fixed`. */
export function QuizRunHud({ engine, total, backTo, onRestart }: {
  engine: QuizEngine;
  total: number;
  backTo: string;
  onRestart: () => void;
}) {
  return (
    <>
      <div className="quiz-hud" data-phase={engine.phase}>
        {engine.phase === "idle" ? (
          <>
            <Link
              to={backTo}
              replace
              state={{ sheet: "full" }}
              className="quiz-hud__back"
            >
              ‹ Quizzes
            </Link>
            <span className="quiz-hud__count numeric">
              {total} rounds
            </span>
          </>
        ) : (
          <>
            <button
              type="button"
              className="quiz-hud__back"
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={engine.abandon}
            >
              ‹ Quizzes
            </button>
            <span className="quiz-hud__timer numeric">
              {formatDuration(engine.elapsedMs)}
            </span>
            <span className="quiz-hud__count numeric">
              {engine.answeredCount} / {engine.totalCount}
            </span>
            <button
              type="button"
              className="quiz-hud__pause"
              aria-label={engine.phase === "paused" ? "Resume" : "Pause"}
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={engine.togglePause}
            >
              <PauseIcon />
            </button>
          </>
        )}
      </div>
      {engine.phase === "paused" && (
        <div className="quiz-pause" role="dialog" aria-label="Paused">
          <p className="quiz-pause__title">Paused</p>
          <p className="quiz-pause__sub">The timer is stopped.</p>
          <button
            type="button"
            className="quiz-pause__btn quiz-pause__btn--primary"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={engine.togglePause}
          >
            Resume
          </button>
          <button
            type="button"
            className="quiz-pause__btn"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={onRestart}
          >
            Restart
          </button>
          <button
            type="button"
            className="quiz-pause__btn"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={engine.abandon}
          >
            Abandon run
          </button>
        </div>
      )}
    </>
  );
}
