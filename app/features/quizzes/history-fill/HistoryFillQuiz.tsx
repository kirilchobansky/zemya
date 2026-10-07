/**
 * "Fill the list" — the run screen of the first History quiz type (logic in
 * app/features/quizzes/history-fill/fill-quiz.ts, rules in docs/quizzes.md). A panel in the middle of the
 * screen holds one empty rectangle per entry, in chronological order, showing only its
 * years; one always-focused input at the top fills them in any order. It doesn't use the
 * geography engine (app/features/quizzes/engine/engine.ts): there is no queue, no target and no map — the
 * run is "a set of names still to find" — but it saves the same run rows, so personal bests
 * work identically (`quizId` = the quiz's id, scope and size both "all").
 *
 * The timer starts at the first keystroke, so reading the grid is free. The screen is
 * portalled into the atlas shell's <main class="stage"> — the area between the rail and the
 * right panel, so it follows their widths and collapsed state with no offsets of its own
 * (on a phone CSS makes it cover the viewport) — and only after mount, since prerender has
 * no `document`. The input is never `disabled`; when a run ends it is just moved out of
 * sight so "Try again" can focus it inside the tap.
 */
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';

import { historyCountryFor } from '~/features/history';
import { formatDuration } from '~/shared/lib/format';
import { FillGrid } from './FillGrid';
import { FillInputBar } from './FillInputBar';
import { FillPhoneHud } from './FillPhoneHud';
import { FillResultButtons, FillResultCard } from './FillResult';
import { FillToggle } from './FillToggle';
import type { FillQuiz } from './fill-quiz';
import { useFillRun } from './use-fill-run';
import { keepFocus } from '~/features/quizzes/engine/QuizControls';
import '~/features/quizzes/engine/quiz-run.css';
import '~/features/quizzes/engine/quiz-list.css';
import '~/features/quizzes/engine/quiz-list.phone.css';
import './HistoryFillQuiz.css';
import './HistoryFillQuiz.grid.css';
import './HistoryFillQuiz.phone.css';

export function HistoryFillQuiz({ quiz, backTo }: { quiz: FillQuiz; backTo: string }) {
  const run = useFillRun(quiz);
  const navigate = useNavigate();
  const {
    phase, phaseRef, paused, toggleOn, setToggleOn, byColumns, setByColumns, runToggle,
    entries, total, showTitles, filled, input, elapsedMs, shaking, setShaking, hint, outcome,
    mounted, host, inputRef, active, revealing, missed, finished,
    togglePause, onChange, onKeyDown, giveUp, restart
  } = run;

  const toggleBox = (hidden: boolean) => (
    <FillToggle quiz={quiz} checked={toggleOn} onChange={setToggleOn} hidden={hidden} />
  );
  const buttons = <FillResultButtons backTo={backTo} onRestart={restart} />;
  const resultHook = (
    <FillResultCard
      quiz={quiz} phase={phase} runToggle={runToggle} elapsedMs={elapsedMs}
      filledCount={filled.size} total={total} missed={missed} outcome={outcome}
    />
  );

  /* Phone: leave at any time, nothing saved (the run is only ever saved by finishing it). */
  const leave = () => navigate(backTo, { state: { sheet: 'full' } });

  const screen = (
    <div className={`fill-quiz${paused ? ' is-paused' : ''}`} role="dialog" aria-label={quiz.title}>
      <div className="fill-quiz__panel">
        <header className="fill-quiz__head">
          <h2 className="fill-quiz__title">{quiz.title}</h2>
          <div className="fill-quiz__stats">
            <span className="quiz-run__timer numeric">{formatDuration(elapsedMs)}</span>
            <span className="quiz-run__count numeric">{filled.size} / {total}</span>
          </div>
        </header>

        {/* phone: the result card the desktop sidebar would show, at the top of the scrolling area */}
        {finished && (
          <div className="fill-quiz__summary">
            {resultHook}
            {toggleBox(false)}
          </div>
        )}

        <FillInputBar
          active={active} phase={phase} phaseRef={phaseRef} inputRef={inputRef} input={input}
          shaking={shaking} onShakeEnd={() => setShaking(false)} onChange={onChange} onKeyDown={onKeyDown}
          onGiveUp={giveUp} onRestart={restart}
        />

        <p className="fill-quiz__hint" role="status">{hint ? 'Add the number, for example II' : ''}</p>

        {/* hidden, not removed, once a run starts: the grid below never jumps */}
        {toggleBox(phase !== 'idle')}

        <label className="fill-quiz__toggle" onMouseDown={keepFocus} onPointerDown={keepFocus}>
          <input type="checkbox" checked={byColumns} onChange={e => setByColumns(e.target.checked)} />
          Read down the columns
        </label>

        <FillGrid entries={entries} filled={filled} revealing={revealing} showTitles={showTitles} byColumns={byColumns} />

        {/* desktop shows the result in the sidebar; a phone run covers the sidebar, so the
            buttons stay here and CSS hides them above the phone breakpoint */}
        {paused && (
          <div className="fill-quiz__pause" role="dialog" aria-label="Paused">
            <p className="fill-quiz__pause-title">Paused</p>
            <p className="fill-quiz__pause-sub">The timer is stopped.</p>
            <button type="button" className="action action--primary" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={togglePause}>
              Resume <kbd>Esc</kbd>
            </button>
          </div>
        )}

        {finished && (
          <div className="fill-quiz__result fill-quiz__result--phone">{buttons}</div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">
          <Link to="/quizzes">Quizzes</Link> · <Link to="/quizzes/history">History</Link> ·{' '}
          <Link to={backTo}>{historyCountryFor(quiz.slug)?.nameEn ?? quiz.slug}</Link>
        </span>
        <h2>{quiz.title}</h2>
      </header>
      <div className="panel__body">
        <p className="quiz-desc">
          {quiz.entries.length} {quiz.kind === 'ruler' ? 'rulers' : 'governments'}, in chronological order. Type a name to fill
          its rectangle — order doesn't matter, the title is optional, Latin letters work.{' '}
          <span className="only-fine">Press Esc to pause once you start.</span>
        </p>
        {paused && (
          <div className="note">
            Paused — the timer is stopped.{' '}
            <span className="only-fine">Press Esc or Resume to continue.</span>
            <span className="only-coarse">Tap Resume to continue.</span>
          </div>
        )}
        {finished ? (
          <>
            {resultHook}
            <div className="fill-quiz__side-toggle">{toggleBox(false)}</div>
            {buttons}
          </>
        ) : (
          // Pause exists only while a run is active: nothing on the start screen
          phase === 'running' && (
            <div className="actions">
              <button type="button" className="action" onClick={togglePause}>
                {paused ? 'Resume' : 'Pause'} <kbd>Esc</kbd>
              </button>
              <Link to={backTo} state={{ sheet: 'full' }} className="action desk-hide">Back to quizzes</Link>
            </div>
          )
        )}
      </div>
      {mounted && host && createPortal(screen, host)}
      {/* phone layout only (`display: none` above the breakpoint): the geography run's HUD and
          pause screen, reused. Portalled to <body> like that run's. */}
      {mounted && createPortal(
        <FillPhoneHud
          phase={phase} paused={paused} total={total} filledCount={filled.size} elapsedMs={elapsedMs}
          onLeave={leave} onTogglePause={togglePause} onRestart={restart} onGiveUp={giveUp}
        />,
        document.body,
      )}
    </>
  );
}
