import type { Ref } from 'react';
import { Link } from 'react-router';

import { SCOPE_LABELS, type QuizScope } from '~/features/countries';
import { formatDuration } from '~/shared/lib/format';
import type { CountryRecord } from '~/engines/map/types';
import { NAME_ALL_QUIZ } from '~/features/quizzes/geography/quizzes';
import { NameAllNamedList } from './NameAllNamedList';
import { NameAllResult } from './NameAllResult';
import type { Outcome, Phase } from './name-all-types';

/** The right-hand panel of a run: header, then the idle / running / result body. */
export function NameAllPanel({
  scope, backTo, ready, phase, paused, total, hint, elapsedMs, named, namedCountries, missed, outcome,
  listEndRef, onTogglePause, onRestart, onGiveUp, onLeave, snapshot
}: {
  scope: QuizScope;
  backTo: string;
  ready: boolean;
  phase: Phase;
  paused: boolean;
  total: number;
  hint: string;
  elapsedMs: number;
  named: readonly string[];
  namedCountries: readonly CountryRecord[];
  missed: readonly CountryRecord[];
  outcome: Outcome | null;
  listEndRef: Ref<HTMLLIElement>;
  onTogglePause: () => void;
  onRestart: () => void;
  onGiveUp: () => void;
  onLeave: () => void;
  snapshot: () => unknown;
}) {
  const running = phase === 'running';
  const finished = phase === 'done' || phase === 'gaveup';
  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">
          <Link to="/quizzes" replace>Quizzes</Link> · <Link to={backTo} replace>Geography</Link> · {SCOPE_LABELS[scope]}
        </span>
        <h2>{NAME_ALL_QUIZ.title}</h2>
      </header>

      <div className="panel__body">
        {!ready && (
          <div className="empty">
            <div className="empty__icon">🌍</div>
            <p>Loading the map.</p>
          </div>
        )}

        {ready && phase === 'idle' && (
          <div className="empty">
            <div className="empty__icon">⌨</div>
            <p>
              Name all {total} countries of {scope === 'world' ? 'the world' : SCOPE_LABELS[scope]} — no prompt, any order,
              English or Bulgarian.{' '}
              <span className="only-fine">Press START — or Space, or Enter — to begin.</span>
              <span className="only-coarse">Tap START to begin.</span> Nothing is timed until you do.
            </p>
          </div>
        )}

        {running && (
          <>
            {/* sticky: stays at the top of the panel while the flag list grows and scrolls */}
            <div className="quiz-run__clock">
              <div className="quiz-run__timer numeric">{formatDuration(elapsedMs)}</div>
              <div className="quiz-run__count numeric">{named.length} / {total}</div>
            </div>
            <div className="name-all__hint" role="status">{hint}</div>
            <div className="actions">
              <button type="button" className="action" onClick={onTogglePause}>
                {paused ? 'Resume' : 'Pause'} <kbd>Esc</kbd>
              </button>
              <button type="button" className="action" onClick={onRestart}>Restart</button>
              <button type="button" className="action" onClick={onGiveUp}>Give up</button>
              <button type="button" className="action" onClick={onLeave}>
                Abandon <kbd>Ctrl+⌫</kbd>
              </button>
            </div>
            {paused && (
              <div className="note">
                Paused — the timer is stopped.{' '}
                <span className="only-fine">Press Esc or Resume to continue.</span>
                <span className="only-coarse">Tap Resume to continue.</span>
              </div>
            )}
            <NameAllNamedList countries={namedCountries} listEndRef={listEndRef} />
          </>
        )}

        {finished && (
          <NameAllResult
            scope={scope} phase={phase} elapsedMs={elapsedMs} named={named}
            namedCountries={namedCountries} total={total} missed={missed} outcome={outcome}
            listEndRef={listEndRef} onRestart={onRestart} snapshot={snapshot}
          />
        )}
      </div>
    </>
  );
}
