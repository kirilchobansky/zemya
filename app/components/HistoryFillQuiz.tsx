/**
 * "Fill the list" — the run screen of the first History quiz type (logic in
 * app/lib/history/fill-quiz.ts, rules in docs/quizzes.md). A panel in the middle of the
 * screen holds one empty rectangle per entry, in chronological order, showing only its
 * years; one always-focused input at the top fills them in any order. It doesn't use the
 * geography engine (app/lib/quiz/engine.ts): there is no queue, no target and no map — the
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
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';

import { keepFocus } from '~/components/quiz/QuizControls';
import { useKeyboard } from '~/lib/keyboard';
import { useAtlasContext } from '~/lib/atlas-context';
import { bestQuizTime, saveQuizRun } from '~/lib/core/progress';
import { formatDuration } from '~/lib/format';
import {
  dateRangeLabel, entriesFor, hasMixedTitles, isShownTitle, matchFill, needsNumber, prepareFill, splitNote, yearLabel, type FillQuiz
} from '~/lib/history/fill-quiz';
import { historyCountryFor } from '~/lib/history/countries';
import { toggleSize } from '~/lib/history/fill-quiz-config';

type Phase = 'idle' | 'running' | 'done' | 'gaveup';

interface Outcome {
  timeMs: number;
  beatBest: boolean;
  previousBest: number | null;
}

const NO_FILLED: ReadonlySet<string> = new Set();

/** Read-down layout: tall columns first. Up to 6 entries make one column, up to 12 two, and
 *  up to 30 three, and longer four (desktop); a phone takes one column up to 8 entries, else two. Items
 *  run top to bottom, then on to the next column. */
function columnLayout(n: number): CSSProperties {
  const cols = n <= 6 ? 1 : n <= 12 ? 2 : n <= 30 ? 3 : 4;
  const phoneCols = n <= 8 ? 1 : 2;
  return {
    '--cols': cols,
    '--rows': Math.ceil(n / cols),
    '--cols-phone': phoneCols,
    '--rows-phone': Math.ceil(n / phoneCols),
  } as CSSProperties;
}

export function HistoryFillQuiz({ quiz, backTo }: { quiz: FillQuiz; backTo: string }) {
  useKeyboard(); // publishes --kb / --vv-top, which size the phone screen to what the keyboard leaves
  const { setQuiz, setImmersive } = useAtlasContext();
  const [phase, setPhase] = useState<Phase>('idle');
  /* The quiz's toggle, as currently chosen. The finished run keeps the setting it was played
     with (`runToggle`) while the result screen lets the player pick the next one. */
  const [toggleOn, setToggleOn] = useState(false);
  const [byColumns, setByColumns] = useState(true);
  const [runToggle, setRunToggle] = useState(false);
  const shownToggle = phase === 'idle' || phase === 'running' ? toggleOn : runToggle;
  const entries = useMemo(() => entriesFor(quiz, shownToggle), [quiz, shownToggle]);
  const prepared = useMemo(() => prepareFill(entries), [entries]);
  const total = entries.length;
  const showTitles = useMemo(() => hasMixedTitles(entries), [entries]);
  const size = toggleSize(quiz.toggle !== null && toggleOn);

  const [filled, setFilled] = useState<ReadonlySet<string>>(NO_FILLED);
  const [input, setInput] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [shaking, setShaking] = useState(false);
  const [hint, setHint] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [priorBest, setPriorBest] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [host, setHost] = useState<Element | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  // refs so two events in one tick (a fast typist, an instant accept then Enter) never read stale state
  const filledRef = useRef<ReadonlySet<string>>(NO_FILLED);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const phaseRef = useRef<Phase>('idle');
  const startedAtRef = useRef(0);
  const elapsedRef = useRef(0);
  phaseRef.current = phase;

  useEffect(() => {
    setHost(document.querySelector('main.stage'));
    setMounted(true);
  }, []);

  /* The map behind the panel goes into quiz mode (search box, toolbar and tooltips hidden,
     names off) exactly as for a geography run; a phone run owns the whole screen. */
  useEffect(() => {
    setQuiz({ target: null, answered: new Map(), showNeighbours: false, showCapital: false, paused: false });
    setImmersive(true);
    return () => {
      setQuiz(null);
      setImmersive(false);
    };
  }, [setQuiz, setImmersive]);

  useEffect(() => {
    let cancelled = false;
    bestQuizTime(quiz.id, 'all', size).then(best => { if (!cancelled) setPriorBest(best); });
    return () => { cancelled = true; };
  }, [quiz.id, size]);

  useEffect(() => {
    if (phase !== 'running' || paused) return;
    const tick = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 100);
    return () => clearInterval(tick);
  }, [phase, paused]);

  /* Esc pauses and resumes a started run. Window-level and the input is never disabled, so
     the key always has somewhere to land (same reasoning as the geography engine). */
  const togglePause = useCallback(() => {
    if (phaseRef.current !== 'running') return;
    if (pausedRef.current) startedAtRef.current = Date.now() - elapsedRef.current;
    else elapsedRef.current = Date.now() - startedAtRef.current;
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    if (pausedRef.current) setElapsedMs(elapsedRef.current);
  }, []);
  useEffect(() => {
    if (phase !== 'running') return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, togglePause]);

  const active = phase === 'idle' || phase === 'running';
  useEffect(() => {
    if (active) inputRef.current?.focus({ preventScroll: true });
    else inputRef.current?.blur();
  }, [active, mounted]);

  const finish = useCallback((next: Phase, timeMs: number) => {
    pausedRef.current = false;
    setPaused(false);
    setElapsedMs(timeMs);
    setRunToggle(toggleOn);
    setPhase(next);
    if (next !== 'done') return;
    const beatBest = priorBest === null || timeMs < priorBest;
    setOutcome({ timeMs, beatBest, previousBest: priorBest });
    setPriorBest(prev => (prev === null ? timeMs : Math.min(prev, timeMs)));
    saveQuizRun({
      quizId: quiz.id, scope: 'all', size, timeMs,
      totalCount: total, firstTryCount: total, revealedCount: 0, at: Date.now()
    });
  }, [priorBest, quiz.id, size, toggleOn, total]);

  const accept = useCallback((index: number) => {
    const next = new Set(filledRef.current).add(prepared[index].id);
    filledRef.current = next;
    setFilled(next);
    setInput('');
    setHint(false);
    if (next.size === total) finish('done', Date.now() - startedAtRef.current);
  }, [prepared, total, finish]);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!active || pausedRef.current) return;
    const value = e.target.value;
    setHint(false);
    if (phaseRef.current === 'idle' && value.trim()) {
      startedAtRef.current = Date.now();
      phaseRef.current = 'running';
      setPhase('running');
    }
    const match = matchFill(value, prepared, filledRef.current);
    if (match && match.instant && !match.typo) accept(match.index);
    else setInput(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !active || pausedRef.current) return;
    e.preventDefault();
    const match = matchFill(input, prepared, filledRef.current);
    if (match) accept(match.index);
    else if (input.trim()) { // nothing is cleared and nothing is penalised
      setShaking(true);
      setHint(needsNumber(input, prepared, filledRef.current));
    }
  };

  const giveUp = () => {
    if (!active) return;
    finish('gaveup', phase === 'running' ? (pausedRef.current ? elapsedRef.current : Date.now() - startedAtRef.current) : 0);
  };

  /* Synchronous focus inside the tap — iOS opens the keyboard only for a focus() made inside
     the gesture itself. */
  const restart = () => {
    pausedRef.current = false;
    setPaused(false);
    filledRef.current = NO_FILLED;
    phaseRef.current = 'idle';
    setFilled(NO_FILLED);
    setInput('');
    setHint(false);
    setElapsedMs(0);
    setOutcome(null);
    setPhase('idle');
    inputRef.current?.focus({ preventScroll: true });
  };

  const toggleBox = (hidden: boolean) => quiz.toggle && (
    <label
      className={`fill-quiz__toggle${hidden ? ' fill-quiz__toggle--off' : ''}`}
      onMouseDown={keepFocus}
      onPointerDown={keepFocus}
    >
      <input type="checkbox" checked={toggleOn} onChange={e => setToggleOn(e.target.checked)} />
      {quiz.toggle.label}
    </label>
  );
  const revealing = phase === 'gaveup';
  const missed = total - filled.size;

  const finished = phase === 'done' || phase === 'gaveup';
  const buttons = (
    <div className="actions">
      <button type="button" className="action action--primary" onClick={restart}>Try again</button>
      <Link to={backTo} state={{ sheet: 'half' }} className="action">Back to quizzes</Link>
    </div>
  );

  const screen = (
    <div className="fill-quiz" role="dialog" aria-label={quiz.title}>
      <div className="fill-quiz__panel">
        <header className="fill-quiz__head">
          <h2 className="fill-quiz__title">{quiz.title}</h2>
          <div className="fill-quiz__stats">
            <span className="quiz-run__timer numeric">{formatDuration(elapsedMs)}</span>
            <span className="quiz-run__count numeric">{filled.size} / {total}</span>
          </div>
        </header>

        <div className={`fill-quiz__bar${active ? '' : ' fill-quiz__bar--off'}`}>
          <input
            ref={inputRef}
            className={`fill-quiz__input${shaking ? ' is-shaking' : ''}`}
            type="text"
            value={input}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onAnimationEnd={() => setShaking(false)}
            onBlur={e => {
              // Stay focused unless focus went to another control (Tab to Give up still works).
              if (phaseRef.current !== 'idle' && phaseRef.current !== 'running') return;
              if (e.relatedTarget) return;
              requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
            }}
            placeholder="Type a name — Enter to confirm"
            aria-label="Type a name"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
          />
          <button
            type="button"
            className="action fill-quiz__pausebtn"
            disabled={phase !== 'running'}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={togglePause}
          >
            {paused ? 'Resume' : 'Pause'} <kbd className="only-fine">Esc</kbd>
          </button>
          <button
            type="button"
            className="action fill-quiz__giveup"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={giveUp}
          >
            Give up
          </button>
        </div>

        <p className="fill-quiz__hint" role="status">{hint ? 'Add the number, for example II' : ''}</p>

        {/* hidden, not removed, once a run starts: the grid below never jumps */}
        {toggleBox(phase !== 'idle')}

        <label className="fill-quiz__toggle" onMouseDown={keepFocus} onPointerDown={keepFocus}>
          <input type="checkbox" checked={byColumns} onChange={e => setByColumns(e.target.checked)} />
          Read down the columns
        </label>

        <ol
          className={
            `fill-quiz__grid${byColumns ? ' fill-quiz__grid--columns' : ''}` +
            (entries.length > 30 ? ' fill-quiz__grid--compact' : '')
          }
          style={byColumns ? columnLayout(entries.length) : undefined}
        >
          {entries.map(entry => {
            const isFilled = filled.has(entry.id);
            const isMissed = revealing && !isFilled;
            const shown = isFilled || isMissed;
            const title = showTitles && isShownTitle(entry.title) ? entry.title : '';
            const label = title ? `${title} ${entry.nameBg}` : entry.nameBg;
            const { main, note } = splitNote(entry.nameBg);
            return (
              <li
                key={entry.id}
                className={
                  `fill-cell fill-cell--${entry.kind}` +
                  (isFilled ? ' is-filled' : '') + (isMissed ? ' is-missed' : '')
                }
                title={shown ? `${label} · ${dateRangeLabel(entry)}` : undefined}
                aria-label={shown ? label : `Empty, ${yearLabel(entry)}`}
              >
                <span className="fill-cell__dates numeric">{yearLabel(entry)}</span>
                <span className="fill-cell__name">
                  {shown && title && <span className="fill-cell__title">{title}</span>}
                  {shown ? main : ''}
                  {shown && note && <span className="fill-cell__note">{note}</span>}
                </span>
              </li>
            );
          })}
        </ol>

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
          <div className="fill-quiz__result fill-quiz__result--phone">
            {toggleBox(false)}
            {buttons}
          </div>
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
            <div className="hook">
              <div className="hook__label">
                {phase === 'done' ? 'Result' : 'Gave up'}
                {quiz.toggle && runToggle && <> · {quiz.toggle.label.toLowerCase()}</>}
              </div>
              <p className="quiz-result__time numeric">{formatDuration(elapsedMs)}</p>
              <p style={{ marginBottom: 0 }}>
                <b>{filled.size} / {total}</b> filled
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
            <div className="fill-quiz__side-toggle">{toggleBox(false)}</div>
            {buttons}
          </>
        ) : (
          <div className="actions">
            <button type="button" className="action" disabled={phase !== 'running'} onClick={togglePause}>
              {paused ? 'Resume' : 'Pause'} <kbd>Esc</kbd>
            </button>
            <Link to={backTo} state={{ sheet: 'half' }} className="action">Back to quizzes</Link>
          </div>
        )}
      </div>
      {mounted && host && createPortal(screen, host)}
    </>
  );
}
