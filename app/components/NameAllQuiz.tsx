/**
 * "Name all countries" — the run screen of the free-recall geography quiz (rules in
 * docs/quizzes.md, matching in app/lib/geography/names.ts's `matchCountryName`). No prompt: the
 * player types country names in any order and each correct one joins a list, in the order named,
 * and is coloured on the map. It doesn't use the geography engine (app/lib/quiz/engine.ts) —
 * there is no queue and no target — but it saves the same run rows as every quiz, under the
 * quiz id "name-all", scope = the continent, size "all", so personal bests work identically.
 *
 * Layout is the geography run's: the map stays live and framed on the scope; the typed-answer
 * input is docked over it (portalled to <body>, like MapStage) with START in idle; the panel
 * (desktop) holds the timer, count, buttons and the list; on a phone the panel is hidden during
 * the run and the HUD + input bar (shared CSS) stand in, the results opening the sheet at full.
 * The input is never `disabled`, and START focuses it inside the tap (iOS keyboard).
 *
 * Only a COMPLETED run is saved. A given-up run shows its score and the missed countries and
 * saves nothing: bestQuizTime is "fastest time", and a quick give-up must not become a best.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';

import { keepFocus } from '~/components/quiz/QuizControls';
import { StartCaption } from '~/components/quiz/StartCaption';
import { useAtlasContext } from '~/lib/atlas-context';
import { bestQuizTime, saveQuizRun } from '~/lib/core/progress';
import { formatDuration } from '~/lib/format';
import { matchCountryName, prepareCountryNames } from '~/lib/geography/names';
import { NAME_ALL_ID, NAME_ALL_QUIZ } from '~/lib/geography/quizzes';
import { continentOf, poolForQuiz, QUIZ_SCOPES, SCOPE_LABELS, SCOPE_VIEWS, type QuizScope } from '~/lib/geography/scopes';
import { loadWorld } from '~/lib/geography/world';
import { useKeyboard, useQuizPageLock } from '~/lib/keyboard';
import { NO_INSETS } from '~/lib/map/follow';
import { measureInsets } from '~/lib/quiz/insets';
import { useUpStep } from '~/lib/up';
import { StageClock } from '~/components/quiz/StageClock';
import type { CountryRecord, World } from '~/lib/map/types';
import { isCoarsePointer, isPhoneLayout } from '~/lib/viewport';

type Phase = 'idle' | 'running' | 'done' | 'gaveup';

interface Outcome {
  beatBest: boolean;
  previousBest: number | null;
}

/** How long an exact name that is also the start of another unnamed country waits for a further key. */
const AUTO_ACCEPT_MS = 500;
const NO_NAMED: readonly string[] = [];

function Flag({ country }: { country: CountryRecord }) {
  return (
    <img
      className="name-all__flag"
      src={`/flags/${country.iso2.toLowerCase()}.svg`}
      alt=""
      width={22}
      height={15}
      loading="lazy"
      decoding="async"
    />
  );
}

export function NameAllQuiz({ scope, backTo }: { scope: QuizScope; backTo: string }) {
  const keyboard = useKeyboard(); // publishes --kb / --vv-top, which size the phone screen to what the keyboard leaves
  const { atlas, setQuiz, setImmersive, setSheetSnap } = useAtlasContext();
  const navigate = useNavigate();

  const [world, setWorld] = useState<World | null>(null);
  const [stageHost, setStageHost] = useState<Element | null>(null);
  const [mounted, setMounted] = useState(false); // portals need `document`; prerender has none
  useEffect(() => {
    setStageHost(document.querySelector('main.stage'));
    setMounted(true);
    let cancelled = false;
    loadWorld().then(w => { if (!cancelled) setWorld(w); });
    return () => { cancelled = true; };
  }, []);

  const pool = useMemo(
    () => (world ? poolForQuiz(world.data.countries, NAME_ALL_ID, scope) : []),
    [world, scope]
  );
  const prepared = useMemo(() => prepareCountryNames(pool), [pool]);
  const byIso3 = useMemo(() => new Map(pool.map(c => [c.iso3, c])), [pool]);
  const total = pool.length;

  const [phase, setPhase] = useState<Phase>('idle');
  const [paused, setPaused] = useState(false);
  const [named, setNamed] = useState<readonly string[]>(NO_NAMED);
  const [input, setInput] = useState('');
  const [hint, setHint] = useState('');
  const [shaking, setShaking] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [priorBest, setPriorBest] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listEndRef = useRef<HTMLLIElement | null>(null);
  // refs so two events in one tick (a fast typist, an instant accept then Enter) never read stale state
  const namedRef = useRef<readonly string[]>(NO_NAMED);
  const namedSetRef = useRef<ReadonlySet<string>>(new Set());
  const phaseRef = useRef<Phase>('idle');
  const pausedRef = useRef(false);
  const startedAtRef = useRef(0);
  const elapsedRef = useRef(0);
  phaseRef.current = phase;

  const running = phase === 'running';
  const active = running; // the input takes answers
  const finished = phase === 'done' || phase === 'gaveup';

  useEffect(() => {
    let cancelled = false;
    bestQuizTime(NAME_ALL_ID, scope, 'all').then(best => { if (!cancelled) setPriorBest(best); });
    return () => { cancelled = true; };
  }, [scope]);

  useEffect(() => {
    if (!running || paused) return;
    const tick = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 100);
    return () => clearInterval(tick);
  }, [running, paused]);

  /* ------------------------------------------------------------------ map */

  /* Quiz mode for the whole lifetime of the route (names, search and tooltips hidden). Depends on
     nothing but the stable setter, so a late-initialising atlas never wipes the answered map. */
  const atlasRef = useRef(atlas);
  atlasRef.current = atlas;
  useEffect(() => {
    setQuiz({ target: null, answered: new Map(), showNeighbours: false, showCapital: false, paused: false });
    return () => {
      setQuiz(null);
      atlasRef.current?.setFocus([]);
    };
  }, [setQuiz]);

  /* Correct countries green; after a give-up the missed ones red. */
  const answered = useMemo(() => {
    const map = new Map<string, 'correct' | 'revealed'>(named.map(iso3 => [iso3, 'correct']));
    if (phase === 'gaveup') for (const c of pool) if (!map.has(c.iso3)) map.set(c.iso3, 'revealed');
    return map;
  }, [named, phase, pool]);
  useEffect(() => {
    setQuiz(prev => (prev ? { ...prev, answered, paused } : prev));
  }, [answered, paused, setQuiz]);

  /* The scope is the camera's home: START, a name and the results all frame it. */
  useEffect(() => {
    if (!atlas) return;
    const view = SCOPE_VIEWS[scope] ?? null;
    atlas.setRegionView(view);
    if (view) atlas.home();
    return () => {
      atlas.setRegionView(null);
      if (view) atlas.home();
    };
  }, [atlas, scope]);
  useEffect(() => {
    if (finished) atlas?.home();
  }, [finished, atlas]);

  /* Phone: the run owns the whole screen from START until its results, which open the sheet at full. */
  const ready = world !== null && total > 0;
  const ownsScreen = ready && !finished;
  useEffect(() => {
    setImmersive(ownsScreen);
    return () => setImmersive(false);
  }, [ownsScreen, setImmersive]);
  useQuizPageLock(ownsScreen);
  useEffect(() => {
    if (finished) setSheetSnap('full');
  }, [finished, setSheetSnap]);
  useEffect(() => {
    if (finished) inputRef.current?.blur();
  }, [finished]);

  /* The map's visible strip is what the HUD and the input bar leave, measured again whenever the
     keyboard opens or closes. The canvas never takes focus from the input during a run. */
  const strip = `${keyboard.kb}:${keyboard.top}:${keyboard.height}`;
  useEffect(() => {
    if (!atlas || !isPhoneLayout()) return;
    atlas.setInsets(running ? measureInsets() : NO_INSETS);
    return () => atlas.setInsets(NO_INSETS);
  }, [atlas, running, strip]);
  useEffect(() => {
    if (!atlas) return;
    atlas.setKeepFocus(running && (isPhoneLayout() || isCoarsePointer()));
    return () => atlas.setKeepFocus(false);
  }, [atlas, running]);

  /* ------------------------------------------------------------------ run */

  const finish = useCallback((next: 'done' | 'gaveup', timeMs: number) => {
    pausedRef.current = false;
    setPaused(false);
    setElapsedMs(timeMs);
    phaseRef.current = next;
    setPhase(next);
    setInput('');
    setHint('');
    if (next !== 'done') return;
    const beatBest = priorBest === null || timeMs < priorBest;
    setOutcome({ beatBest, previousBest: priorBest });
    setPriorBest(prev => (prev === null ? timeMs : Math.min(prev, timeMs)));
    saveQuizRun({
      quizId: NAME_ALL_ID, scope, size: 'all', timeMs,
      totalCount: total, firstTryCount: total, revealedCount: 0, at: Date.now()
    });
  }, [priorBest, scope, total]);

  const accept = useCallback((index: number, already: boolean) => {
    const country = byIso3.get(prepared[index].iso3);
    setInput('');
    if (already) { // a repeat is a hint, not an error
      setHint(`Already named${country ? `: ${country.name}` : ''}`);
      return;
    }
    setHint('');
    const next = [...namedRef.current, prepared[index].iso3];
    namedRef.current = next;
    namedSetRef.current = new Set(next);
    setNamed(next);
    if (next.length === total) finish('done', Date.now() - startedAtRef.current);
  }, [byIso3, prepared, total, finish]);

  /* START focuses the input SYNCHRONOUSLY, inside the tap — iOS opens the keyboard only for a
     focus() made within the gesture itself. */
  const startRun = () => {
    if (phaseRef.current !== 'idle' || !ready) return;
    inputRef.current?.focus({ preventScroll: true });
    startedAtRef.current = Date.now();
    phaseRef.current = 'running';
    setPhase('running');
  };

  /* Restart (active run only): a fresh run, nothing saved. */
  const restart = () => {
    pausedRef.current = false;
    setPaused(false);
    namedRef.current = NO_NAMED;
    namedSetRef.current = new Set();
    setNamed(NO_NAMED);
    setInput('');
    setHint('');
    setOutcome(null);
    elapsedRef.current = 0;
    setElapsedMs(0);
    inputRef.current?.focus({ preventScroll: true });
    startedAtRef.current = Date.now();
    phaseRef.current = 'running';
    setPhase('running');
  };

  const giveUp = () => {
    if (phaseRef.current !== 'running') return;
    finish('gaveup', pausedRef.current ? elapsedRef.current : Date.now() - startedAtRef.current);
  };

  const leave = () => navigate(backTo, { state: { sheet: 'full' } });

  /* The panel's Up from a run or its results: back to the start screen, nothing saved. */
  const toStart = () => {
    pausedRef.current = false;
    setPaused(false);
    namedRef.current = NO_NAMED;
    namedSetRef.current = new Set();
    setNamed(NO_NAMED);
    setInput('');
    setHint('');
    setOutcome(null);
    elapsedRef.current = 0;
    setElapsedMs(0);
    phaseRef.current = 'idle';
    setPhase('idle');
  };
  useUpStep(phase !== 'idle', toStart);

  const togglePause = useCallback(() => {
    if (phaseRef.current !== 'running') return;
    if (pausedRef.current) startedAtRef.current = Date.now() - elapsedRef.current;
    else elapsedRef.current = Date.now() - startedAtRef.current;
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    if (pausedRef.current) setElapsedMs(elapsedRef.current);
  }, []);

  /* An exact name that is also the start of a longer, still unnamed one ("niger" / "nigeria",
     "dominica" / "dominican republic") is accepted after AUTO_ACCEPT_MS without a further key;
     any key before that cancels it and the player keeps typing. Enter takes it at once. */
  const acceptTimerRef = useRef<number | null>(null);
  const cancelAccept = useCallback(() => {
    if (acceptTimerRef.current !== null) window.clearTimeout(acceptTimerRef.current);
    acceptTimerRef.current = null;
  }, []);
  useEffect(() => cancelAccept, [cancelAccept]);
  useEffect(() => { if (paused || !active) cancelAccept(); }, [paused, active, cancelAccept]);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!active || pausedRef.current) return;
    cancelAccept();
    const value = e.target.value;
    setHint('');
    const match = matchCountryName(value, prepared, namedSetRef.current);
    if (match && match.instant && !match.typo) { accept(match.index, match.already); return; }
    setInput(value);
    if (match && !match.typo && !match.already) {
      acceptTimerRef.current = window.setTimeout(() => {
        acceptTimerRef.current = null;
        if (phaseRef.current === 'running' && !pausedRef.current) accept(match.index, false);
      }, AUTO_ACCEPT_MS);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !active || pausedRef.current) return;
    e.preventDefault();
    cancelAccept();
    const match = matchCountryName(input, prepared, namedSetRef.current);
    if (match) accept(match.index, match.already);
    else if (input.trim()) setShaking(true); // nothing is cleared and nothing is penalised
  };

  /* Window keys. Idle: Space or Enter starts (the input is hidden, so it can't carry them).
     Running: Esc pauses, Ctrl+Backspace abandons, and a printable key aimed at anything that
     isn't a text field refocuses the input — the browser then delivers the character to it. */
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing) return;
      if (phase === 'idle') {
        if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); startRun(); }
        return;
      }
      if (phase !== 'running') return;
      if (e.key === 'Escape') { e.preventDefault(); togglePause(); return; }
      if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); leave(); return; }
      const el = e.target as Element | null;
      if (el?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
      if (e.ctrlKey || e.altKey || e.metaKey || pausedRef.current) return;
      if (e.key.length === 1 || e.key === 'Backspace') inputRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // startRun and leave read only refs and stable values; re-binding per render would add nothing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, phase, togglePause]);

  useEffect(() => {
    if (running) inputRef.current?.focus({ preventScroll: true });
  }, [running]);

  /* the newest name stays in view in the list */
  useEffect(() => {
    if (running) listEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [named.length, running]);

  /* Test seam, like engine.ts's: DEV only, dead code in a production build. */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __zemyaQuiz?: unknown }).__zemyaQuiz = { phase, answeredCount: named.length, elapsedMs };
  }, [phase, named.length, elapsedMs]);

  /* ------------------------------------------------------------------ render */

  const namedCountries = useMemo(
    () => named.map(iso3 => byIso3.get(iso3)).filter((c): c is CountryRecord => Boolean(c)),
    [named, byIso3]
  );
  const missed = useMemo(
    () => (phase === 'gaveup' ? pool.filter(c => !namedSetRef.current.has(c.iso3)) : []),
    // `named` changes the set the ref holds; phase flips once, at give-up
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, pool, named]
  );
  const title = scope === 'world' ? NAME_ALL_QUIZ.title : `${NAME_ALL_QUIZ.title} — ${SCOPE_LABELS[scope]}`;

  const resultHook = (
    <div className="hook">
      <div className="hook__label">{phase === 'done' ? 'Result' : 'Gave up'}</div>
      <p className="quiz-result__time numeric">{formatDuration(elapsedMs)}</p>
      <p style={{ marginBottom: 0 }}>
        <b>{named.length} / {total}</b> named
        {phase === 'gaveup' && <> — {missed.length} missed, shown in red</>}.{' '}
        {phase === 'done' && outcome && (
          outcome.beatBest
            ? outcome.previousBest !== null
              ? <>New personal best — beat <b>{formatDuration(outcome.previousBest)}</b>.</>
              : <>First run of this quiz — now your personal best.</>
            : <>Personal best stays <b>{formatDuration(outcome.previousBest ?? elapsedMs)}</b>.</>
        )}
        {phase === 'gaveup' && <> A given-up run is not saved.</>}
      </p>
    </div>
  );

  /** The missed countries, grouped by continent for the World quiz. */
  const missedGroups = scope === 'world'
    ? QUIZ_SCOPES.filter(s => s !== 'world')
        .map(s => ({ label: SCOPE_LABELS[s], list: missed.filter(c => continentOf(c) === s) }))
        .filter(g => g.list.length > 0)
    : [{ label: '', list: missed }];

  const namedList = (
    <ol className="name-all__list" aria-label="Countries named">
      {namedCountries.map((c, i) => (
        <li key={c.iso3} className="name-all__item" ref={i === namedCountries.length - 1 ? listEndRef : undefined}>
          <Flag country={c} />
          <span>{c.name}</span>
        </li>
      ))}
    </ol>
  );

  const hudCount = <span className="quiz-hud__count numeric">{named.length} / {total}</span>;
  const ctlPhase = phase === 'running' ? (paused ? 'paused' : 'running') : phase === 'idle' ? 'idle' : 'done';

  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">
          <Link to="/quizzes">Quizzes</Link> · <Link to={backTo}>Geography</Link> · {SCOPE_LABELS[scope]}
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
              <button type="button" className="action" onClick={togglePause}>
                {paused ? 'Resume' : 'Pause'} <kbd>Esc</kbd>
              </button>
              <button type="button" className="action" onClick={restart}>Restart</button>
              <button type="button" className="action" onClick={giveUp}>Give up</button>
              <button type="button" className="action" onClick={leave}>
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
            {namedList}
          </>
        )}

        {finished && (
          <>
            {resultHook}
            {missed.length > 0 && (
              <section>
                <h3 className="subhead">Missed — {missed.length}</h3>
                {missedGroups.map(group => (
                  <div key={group.label || 'all'} className="name-all__group">
                    {group.label && <h4 className="name-all__continent">{group.label} · {group.list.length}</h4>}
                    <div className="neighbours">
                      {group.list.map(c => (
                        <Link className="neighbour" key={c.iso3} to={`/country/${c.slug}`}>
                          <Flag country={c} /> {c.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )}
            {named.length > 0 && (
              <section>
                <h3 className="subhead">Named — {named.length}, in the order you found them</h3>
                {namedList}
              </section>
            )}
            <div className="actions">
              <button type="button" className="action action--primary" onClick={restart}>Run it again</button>
              <Link to={backTo} state={{ sheet: 'full' }} className="action desk-hide">Back to quizzes</Link>
            </div>
          </>
        )}
      </div>

      {running && <StageClock host={stageHost} ms={elapsedMs} />}
      {paused && stageHost && createPortal(
        <div className="quiz-pause-desk" role="dialog" aria-label="Paused">
          <p className="quiz-pause__title">Paused</p>
          <p className="quiz-pause__sub">The timer is stopped.</p>
          <button type="button" className="action action--primary" onClick={togglePause}>
            Resume <kbd>Esc</kbd>
          </button>
        </div>,
        stageHost
      )}

      {/* The docked input (desktop) / input bar on the keyboard (phone) and, on a phone, the HUD
          and pause screen — portalled to <body>: the panel is a transformed sheet, which would
          trap `position: fixed`. Rendered in every phase so START has an input to focus. */}
      {mounted && createPortal(
        <>
          <div className="quiz-dock" data-phase={ctlPhase}>
            {phase === 'idle' && ready && (
              <>
                <button type="button" className="quiz-dock__start" onClick={startRun}>START</button>
                <StartCaption />
              </>
            )}
            <div className="quiz-controls" data-phase={ctlPhase}>
              <div className="quiz-feedback">
                {running && hint && <div className="quiz-dock__answer" role="status">{hint}</div>}
              </div>
              <div className="quiz-dock__row">
                <input
                  ref={inputRef}
                  className={
                    `quiz-dock__input${paused ? ' quiz-dock__input--paused' : ''}` +
                    `${running ? '' : ' quiz-dock__input--idle'}${shaking ? ' is-shaking' : ''}`
                  }
                  type="text"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  inputMode="text"
                  enterKeyHint="done"
                  tabIndex={running ? undefined : -1}
                  aria-hidden={running ? undefined : true}
                  value={input}
                  onChange={onChange}
                  onKeyDown={onKeyDown}
                  onAnimationEnd={() => setShaking(false)}
                  placeholder={paused ? 'Paused' : 'Type a country — Enter to confirm'}
                  aria-label="Type a country"
                />
                {running && (
                  <button
                    type="button"
                    className="quiz-dock__btn quiz-dock__btn--text"
                    onPointerDown={keepFocus}
                    onMouseDown={keepFocus}
                    onClick={giveUp}
                  >
                    Give up
                  </button>
                )}
              </div>
            </div>
          </div>

          {!finished && (
            <div className="quiz-hud" data-phase={phase}>
              {phase === 'idle' ? (
                <>
                  <Link to={backTo} state={{ sheet: 'full' }} className="quiz-hud__back">‹ Quizzes</Link>
                  <span className="quiz-hud__count numeric">{total} countries</span>
                </>
              ) : (
                <>
                  <button type="button" className="quiz-hud__back" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={leave}>
                    ‹ Quizzes
                  </button>
                  <span className="quiz-hud__timer numeric">{formatDuration(elapsedMs)}</span>
                  {hudCount}
                  <button
                    type="button"
                    className="quiz-hud__pause"
                    aria-label={paused ? 'Resume' : 'Pause'}
                    onPointerDown={keepFocus}
                    onMouseDown={keepFocus}
                    onClick={togglePause}
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
              <button type="button" className="quiz-pause__btn quiz-pause__btn--primary" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={togglePause}>
                Resume
              </button>
              <button type="button" className="quiz-pause__btn" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={restart}>
                Restart
              </button>
              <button type="button" className="quiz-pause__btn" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={giveUp}>
                Give up
              </button>
              <button type="button" className="quiz-pause__btn" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={leave}>
                Abandon run
              </button>
            </div>
          )}
        </>,
        document.body
      )}
    </>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8.5 6v12M15.5 6v12" />
    </svg>
  );
}
