import type { ReactNode } from 'react';

import { SCOPE_LABELS, type QuizScope } from '~/features/countries';
import { formatDuration } from "~/shared/lib/format";
import type { CountryRecord } from "~/engines/map/types";
import type { QuizEngine } from '../engine/engine';
import type { QuizDefinition } from '../engine/types';
import { QuizRunResult } from './QuizRunResult';

/** The right-hand panel of a run: header, then the idle / running / results body. The Stage's
 *  own panel slot comes in as `panelStage`. */
export function QuizRunPanel({ engine, definition, scope, countries, revealed, backTo, panelStage, onRestart, onRunAgain }: {
  engine: QuizEngine;
  definition: Pick<QuizDefinition, 'title'>;
  scope: QuizScope;
  countries: CountryRecord[];
  revealed: boolean;
  backTo: string;
  panelStage: ReactNode;
  onRestart: () => void;
  onRunAgain: () => void;
}) {
  return (
    <>
        <header className="panel__head">
          <span className="panel__eyebrow">
            {definition.title} · {SCOPE_LABELS[scope]}
          </span>
          <h2>{countries.length} rounds</h2>
        </header>

        <div className="panel__body">
          {engine.phase === "idle" && (
            <div className="empty">
              <div className="empty__icon">⌨</div>
              <p>
                <span className="only-fine">
                  Press START — or Space, or Enter — to begin.
                </span>
                <span className="only-coarse">Tap START to begin.</span> Nothing
                is timed until you do.
              </p>
            </div>
          )}

          {(engine.phase === "running" || engine.phase === "paused") && (
            <>
              {/* sticky: stays at the top of the panel while the body scrolls */}
              <div className="quiz-run__clock">
                <div className="quiz-run__timer numeric">
                  {formatDuration(engine.elapsedMs)}
                </div>
                <div className="quiz-run__count numeric">
                  {engine.answeredCount} / {engine.totalCount}
                </div>
              </div>

              {/* always present, empty when there is nothing to say — the buttons below it
                  must not jump when a note appears or clears */}
              <div className="quiz-run__note-slot">
                {engine.lastNote && <div className="note">{engine.lastNote}</div>}
              </div>

              <div className="actions">
                <button
                  type="button"
                  className="action"
                  onClick={engine.skip}
                  disabled={engine.remainingCount < 2}
                >
                  Skip <kbd>Tab</kbd>
                </button>
                <button
                  type="button"
                  className="action"
                  onClick={engine.reveal}
                  disabled={!engine.target || revealed}
                >
                  Reveal <kbd>Ctrl+Enter</kbd>
                </button>
                <button
                  type="button"
                  className="action"
                  onClick={engine.togglePause}
                >
                  {engine.phase === "paused" ? "Resume" : "Pause"} <kbd>Esc</kbd>
                </button>
                <button type="button" className="action" onClick={onRestart}>
                  Restart
                </button>
                <button type="button" className="action" onClick={engine.abandon}>
                  Abandon <kbd>Ctrl+⌫</kbd>
                </button>
              </div>

              {panelStage}

              {engine.phase === "paused" && (
                <div className="note">
                  Paused — the timer is stopped.{" "}
                  <span className="only-fine">
                    Press Esc or Resume to continue.
                  </span>
                  <span className="only-coarse">Tap Resume to continue.</span>
                </div>
              )}
            </>
          )}

          {engine.phase === "done" && engine.result && (
          <QuizRunResult engine={engine} total={countries.length} onRunAgain={onRunAgain} />
        )}
      </div>
    </>
  );
}
