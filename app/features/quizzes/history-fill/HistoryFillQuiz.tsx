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
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';

import { historyCountryFor } from '~/features/history';
import { formatDuration } from '~/shared/lib/format';
import { FillGrid } from './FillGrid';
import { FillInputBar } from './FillInputBar';
import { FillPhoneHud } from './FillPhoneHud';
import { FillResultButtons, FillResultCard } from './FillResult';
import { FillToggle } from './FillToggle';
import type { FillQuiz } from './fill-quiz';
import { useFillRun } from './use-fill-run';
import { useGo } from '~/shared/lib/navigation';
import { keepFocus } from '~/features/quizzes/engine/QuizControls';
import '~/features/quizzes/engine/quiz-run.css';
import '~/features/quizzes/engine/quiz-list.css';
import '~/features/quizzes/engine/quiz-list.phone.css';
import './HistoryFillQuiz.css';
import './HistoryFillQuiz.grid.css';
import './HistoryFillQuiz.phone.css';

const PHONE_QUERY = '(max-width: 819px), (pointer: coarse) and (max-height: 499px)';

export function HistoryFillQuiz({ quiz, backTo }: { quiz: FillQuiz; backTo: string }) {
  const run = useFillRun(quiz);
  const go = useGo();
  const {
    phase, phaseRef, paused, toggleOn, setToggleOn, byColumns, setByColumns, runToggle,
    entries, total, showTitles, filled, input, elapsedMs, shaking, setShaking, hint, outcome,
    mounted, host, inputRef, active, revealing, missed, finished,
    togglePause, onChange, onKeyDown, giveUp, restart, review
  } = run;

  const toggleBox = (hidden: boolean) => (
    <FillToggle quiz={quiz} checked={toggleOn} onChange={setToggleOn} hidden={hidden} />
  );
  const resultHook = (
    <FillResultCard
      quiz={quiz} phase={phase} runToggle={runToggle} elapsedMs={elapsedMs}
      filledCount={filled.size} total={total} missed={missed} outcome={outcome}
    />
  );

  /* Phone: leave at any time, nothing saved (the run is only ever saved by finishing it). */
  const leave = () => go(backTo, { state: { sheet: 'full' }, replace: true });

  // a finished or given-up run scrolls the screen back to its top, where the score is
  const screenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (finished) screenRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [finished]);

  // phone: the entry just filled rests as the second one from the top of the scroll area (the
  // first and last entries can't, the scroll range ends there); "Review mistakes" does the same
  // for the first missed entry once the result card is gone and the layout has settled
  const scrollToEntry = (id: string | undefined) => {
    const screenEl = screenRef.current;
    if (!screenEl || id === undefined) return;
    if (!window.matchMedia(PHONE_QUERY).matches) return;
    const cell = [...screenEl.querySelectorAll<HTMLElement>('[data-entry]')].find(el => el.dataset.entry === id);
    if (!cell) return;
    const delta = cell.getBoundingClientRect().top - screenEl.getBoundingClientRect().top - cell.offsetHeight;
    screenEl.scrollTo({ top: screenEl.scrollTop + delta, behavior: 'smooth' });
  };
  const seenRef = useRef<ReadonlySet<string>>(filled);
  useEffect(() => {
    const seen = seenRef.current;
    seenRef.current = filled;
    if (finished || filled.size <= seen.size) return;
    scrollToEntry([...filled].find(x => !seen.has(x)));
  }, [filled, finished]);

  const reviewTargetRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (phase !== 'running' || reviewTargetRef.current === undefined) return;
    scrollToEntry(reviewTargetRef.current);
    reviewTargetRef.current = undefined;
  }, [phase]);
  const onReview = () => {
    reviewTargetRef.current = entries.find(e => !filled.has(e.id))?.id;
    review();
  };

  const buttons = <FillResultButtons phase={phase} onRestart={restart} onReview={onReview} />;

  const screen = (
    <div ref={screenRef} className={`fill-quiz${paused ? ' is-paused' : ''}`} role="dialog" aria-label={quiz.title}>
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
          <Link to="/quizzes" replace>Quizzes</Link> · <Link to="/quizzes/history" replace>History</Link> ·{' '}
          <Link to={backTo} replace>{historyCountryFor(quiz.slug)?.nameEn ?? quiz.slug}</Link>
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
              <Link to={backTo} state={{ sheet: 'full' }} replace className="action desk-hide">Back to quizzes</Link>
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
