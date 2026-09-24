/**
 * One route for every quiz — /quizzes/:subject/:quizId/:scope/:size — looked up by id
 * within its subject (app/lib/quiz/subjects.ts, backed by app/lib/geography/quizzes.ts's
 * QUIZ_DEFINITIONS for geography). All the run logic (queue, timer, pause/resume, abandon,
 * grading, results, personal best) lives in the shared engine (app/lib/quiz/engine.ts),
 * which knows nothing about the map. This file is the "atlas bridge": it owns the handful
 * of things every quiz needs from the atlas layout — hiding the search box/toolbar/tooltip
 * for the run's whole lifetime, returning the camera to the world view on START and on
 * finish, and mirroring the run's target/answered/neighbour state into the map's own
 * quiz-mode painting (harmless, if invisible, for a quiz whose Stage doesn't use the map at
 * all — see the flags quiz). Only the *visual* per-question experience — what's drawn
 * where, using what input layout — is left to the quiz's own Stage component. See
 * CLAUDE.md's Quizzes section.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, Navigate, useNavigate, useParams } from 'react-router';

import { useAtlasContext } from './atlas';
import { allCountries } from '~/lib/geography/catalog.server';
import { quizPageSeo } from '~/lib/geography/quizSeo';
import { pageMeta } from '~/lib/seo';
import type { Route } from './+types/quizzes.$subject.$quizId';
import { useQuizEngine } from '~/lib/quiz/engine';
import { formatDuration } from '~/lib/format';
import { subjectById, quizInSubject } from '~/lib/quiz/subjects';
import { topByPopulation } from '~/lib/geography/quizzes';
import { isQuizScope, isQuizSize, LEGACY_SCOPES, poolForScope, SCOPE_LABELS, SCOPE_VIEWS, sizesForPool, type QuizSize } from '~/lib/geography/scopes';
import { loadWorld, peekWorld } from '~/lib/geography/world';
import { keepFocus } from '~/components/quiz/QuizControls';
import { useKeyboard } from '~/lib/keyboard';
import { NO_INSETS, type Insets } from '~/lib/map/follow';
import { isCoarsePointer, isPhoneLandscape, isPhoneLayout } from '~/lib/viewport';
import type { CountryRecord, World } from '~/lib/map/types';

/** What sits on top of the canvas during a run, so a target hidden under it counts as not
 *  visible. Desktop: the docked input, at the bottom. The right-hand panel is a grid column
 *  BESIDE the stage, not over it, so a country "behind the panel" is simply off the canvas and
 *  needs no inset. Phone: the strip between the HUD (top) and the input bar (bottom, sitting on
 *  the keyboard) — measured from the DOM, so it is whatever the keyboard has made it right now. */
function measureInsets(): Insets {
  const canvas = document.querySelector('.stage__canvas');
  if (!canvas) return NO_INSETS;
  const c = canvas.getBoundingClientRect();
  if (!isPhoneLayout()) {
    const dock = document.querySelector('.quiz-dock');
    if (!dock) return NO_INSETS;
    return { ...NO_INSETS, bottom: Math.max(0, c.bottom - dock.getBoundingClientRect().top) };
  }
  const hud = document.querySelector('.quiz-hud');
  const bar = document.querySelector('.quiz-controls');
  if (!hud || !bar) return NO_INSETS;
  if (isPhoneLandscape()) {
    // landscape: the HUD sits inline at the left of the input bar, both on the keyboard; the
    // answer chip floats just above them. The map gets everything above that.
    const feedback = document.querySelector('.quiz-controls .quiz-feedback');
    const barTop = Math.min(hud.getBoundingClientRect().top, bar.getBoundingClientRect().top,
      feedback ? feedback.getBoundingClientRect().top : Infinity);
    return { ...NO_INSETS, bottom: Math.max(0, c.bottom - barTop) };
  }
  return {
    ...NO_INSETS,
    top: Math.max(0, hud.getBoundingClientRect().bottom - c.top),
    bottom: Math.max(0, c.bottom - bar.getBoundingClientRect().top)
  };
}

/** Build-time only: the size of the scope's pool, which the title says ("All 46 Countries")
 *  and which only the catalogue knows. */
export function loader({ params }: Route.LoaderArgs) {
  const scope = params.scope ?? '';
  return { poolSize: isQuizScope(scope) ? poolForScope(allCountries(), scope).length : 0 };
}

/** The pool size from the in-memory catalogue when loaded, else the prerendered data. */
export async function clientLoader({ params, serverLoader }: Route.ClientLoaderArgs) {
  const world = peekWorld();
  if (!world) return serverLoader();
  const scope = params.scope ?? '';
  return { poolSize: isQuizScope(scope) ? poolForScope(world.data.countries, scope).length : 0 };
}

export function meta({ params, loaderData, location }: Route.MetaArgs) {
  const subject = params.subject ? subjectById(params.subject) : undefined;
  const definition = subject && params.quizId ? quizInSubject(subject, params.quizId) : undefined;
  const { scope = '', size = '' } = params;
  if (!definition || !isQuizScope(scope) || !isQuizSize(size)) {
    return pageMeta({ title: 'Quiz — Zemya', description: 'A timed quiz.', path: location.pathname, noindex: true });
  }
  return pageMeta({
    ...quizPageSeo(definition, scope, size, loaderData?.poolSize ?? 0),
    path: location.pathname
  });
}

export default function QuizRun() {
  const navigate = useNavigate();
  const params = useParams<{ subject: string; quizId: string; scope: string; size: string }>();
  const subject = params.subject ? subjectById(params.subject) : undefined;
  const definition = subject && params.quizId ? quizInSubject(subject, params.quizId) : undefined;
  const scope = params.scope && isQuizScope(params.scope) ? params.scope : null;
  const requestedSize = params.size && isQuizSize(params.size) ? params.size : null;
  const backTo = `/quizzes/${params.subject}`;

  const { atlas, setQuiz, setImmersive, setSheetSnap } = useAtlasContext();
  const keyboard = useKeyboard();

  const [world, setWorld] = useState<World | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadWorld().then(w => { if (!cancelled) setWorld(w); });
    return () => { cancelled = true; };
  }, []);

  /** The whole scope's pool, before any Top-N cut — its length decides which sizes exist. */
  const pool = useMemo(
    () => (world && scope ? poolForScope(world.data.countries, scope) : []),
    [world, scope]
  );
  /** A size the pool can't offer (e.g. 50 of Oceania's 14, or a hand-typed URL) is not a
   *  run — the catalogue is the only thing that should be linking here. */
  const size: QuizSize | null =
    requestedSize && pool.length && sizesForPool(pool.length).includes(requestedSize) ? requestedSize : null;

  const countries = useMemo(
    () => (definition && size ? topByPopulation(pool, size) : []),
    [definition, pool, size]
  );

  const abandon = () => navigate(backTo, { state: { sheet: 'half' } });
  const engine = useQuizEngine(
    definition ?? { id: 'unknown', facet: 'location' },
    countries,
    scope ?? 'world',
    requestedSize ?? 'all',
    abandon
  );

  /* quiz mode covers the whole lifetime of this route, not just the running phase — the
     map should already be in its stripped-down, full-screen state on the START (idle)
     screen. Torn down on unmount so leaving the run restores the normal map.
     Deliberately depends on nothing but the (stable) setQuiz setter: if this also
     depended on `atlas`, it would re-fire — and wipe the in-progress answered map — the
     moment the Atlas controller finished initialising after this route had already
     mounted and the user had started answering. */
  const atlasRef = useRef(atlas);
  atlasRef.current = atlas;
  const markCapital = Boolean(definition?.markCapital);
  useEffect(() => {
    setQuiz({ target: null, answered: new Map(), showNeighbours: false, showCapital: markCapital, paused: false });
    return () => {
      setQuiz(null);
      atlasRef.current?.setFocus([]); // don't leave a random country's pin permanently enlarged
    };
  }, [setQuiz, markCapital]);

  /* little to no zoom, on purpose — the run stays at (roughly) the world view the whole
     time, so a target is found by its highlight (or, for a quiz whose Stage doesn't use
     the map at all, isn't found on the map at all) rather than the camera flying to it;
     see CLAUDE.md's Quizzes section. Watches phase transitions rather than running once
     per render. */
  /* A continent quiz's "home" is that continent, not the world: START, a guess, the results
     screen and ⌂ all return to it. Declared before the START effect below so the very first
     home() already frames the continent. Cleared on unmount so the atlas is a world map
     again. */
  useEffect(() => {
    if (!atlas) return;
    const view = (scope && SCOPE_VIEWS[scope]) || null;
    atlas.setRegionView(view);
    if (view) atlas.home(); // show the continent behind the START dock, not the whole world
    return () => {
      atlas.setRegionView(null);
      if (view) atlas.home();
    };
  }, [atlas, scope]);

  /* Phone layout: a run owns the whole screen — no sheet, no tab bar — from the START screen
     until its results, which open the sheet at full height. Only for a valid run: the
     "not found" and "preparing" states keep the tab bar, so nobody is stranded. No effect on
     desktop, where the shell has no such state. */
  const validRun = Boolean(definition && scope && requestedSize && world && size);
  const runOwnsScreen = validRun && engine.phase !== 'done';
  useEffect(() => {
    setImmersive(runOwnsScreen);
    return () => setImmersive(false);
  }, [runOwnsScreen, setImmersive]);
  const finished = validRun && engine.phase === 'done';
  useEffect(() => {
    if (finished) setSheetSnap('full');
  }, [finished, setSheetSnap]);

  /* The camera's visible area during a phone run is the strip between the HUD and the input bar,
     and the input bar rides on the keyboard — so it is measured again whenever the keyboard opens
     or closes, and the current target is followed again inside the new strip (it may now be
     behind the keyboard). Declared before the START and target effects below, so on the first
     question the camera already knows the strip. Desktop: measured once per phase, as before. */
  const running = engine.phase === 'running' || engine.phase === 'paused';
  const targetRef = useRef(engine.target);
  targetRef.current = engine.target;
  // the strip changes when the keyboard covers the layout viewport (iOS) or shrinks it (Android)
  const strip = `${keyboard.kb}:${keyboard.top}:${keyboard.height}`;
  const lastFollowedStripRef = useRef(strip);
  useEffect(() => {
    if (!atlas || !isPhoneLayout()) return;
    atlas.setInsets(running ? measureInsets() : NO_INSETS);
    return () => atlas.setInsets(NO_INSETS);
  }, [atlas, running, strip]);
  useEffect(() => {
    if (lastFollowedStripRef.current === strip) return;
    lastFollowedStripRef.current = strip;
    const target = targetRef.current;
    if (!world || !atlas || !running || !target || definition?.hidesMap || !isPhoneLayout()) return;
    const feature = world.byIso3.get(target.iso3);
    if (!feature) return;
    const place = definition?.markCapital ? world.places.find(mark => mark.feature === feature) ?? null : null;
    // two frames on: where the keyboard resized the layout viewport, the atlas hears about its
    // new canvas size from a ResizeObserver that has not fired yet
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        atlas.followTarget({ feature, place }, measureInsets()); // no pulse: it is the same question
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [strip, world, atlas, running, definition]);

  /* The canvas must not take focus during a run: dragging or pinching the map must never blur
     the input or close the keyboard. Only where there IS a keyboard to protect — a phone layout
     or a touch pointer. On desktop a canvas click still blurs the input, and the typing capture
     in engine.ts (which test/smoke.mjs exercises) is what gets the next keystroke back into it. */
  useEffect(() => {
    if (!atlas) return;
    atlas.setKeepFocus(running && (isPhoneLayout() || isCoarsePointer()));
    return () => atlas.setKeepFocus(false);
  }, [atlas, running]);

  /* The results sheet covers the screen: the keyboard has done its job. */
  useEffect(() => {
    if (finished) engine.inputRef.current?.blur();
  }, [finished, engine.inputRef]);

  const prevPhaseRef = useRef(engine.phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    // START only — idle/done -> running. Resuming from pause is ALSO "not running -> running",
    // and used to reset the player's zoom to the world view.
    if ((prev === 'idle' || prev === 'done') && engine.phase === 'running') atlas?.home();
    if (prev !== 'done' && engine.phase === 'done') {
      atlas?.home();
      atlas?.setFocus([]);
    }
    prevPhaseRef.current = engine.phase;
  }, [engine.phase, atlas]);

  /* Each NEW question — however we got to it: correct, skipped, revealed-then-answered — goes
     through Atlas#followTarget, the one place the quiz camera decides (return home if zoomed in,
     then centre / fit / zoom in until legible; see follow.ts), then pulses the target once so it
     can be found. Ordered after the START effect above, so on the first question the camera is
     already home. Keyed on the target changing, not on renders: a wrong attempt leaves the
     target alone, so it neither moves the camera nor pulses, and resuming from pause doesn't. */
  const lastPulsedRef = useRef<string | null>(null);
  useEffect(() => {
    if (engine.phase === 'idle' || engine.phase === 'done') {
      lastPulsedRef.current = null;
    }
    if (!world || !atlas || engine.phase !== 'running' || definition?.hidesMap) return;
    const iso3 = engine.target?.iso3 ?? null;
    if (!iso3 || iso3 === lastPulsedRef.current) return;
    lastPulsedRef.current = iso3;
    const feature = world.byIso3.get(iso3);
    if (!feature) return;
    const place = definition?.markCapital ? world.places.find(mark => mark.feature === feature) ?? null : null;
    atlas.followTarget({ feature, place }, measureInsets()); // the one camera decision, however we got here
    atlas.pulse(place?.ux ?? feature.ux, place?.uy ?? feature.uy);
  }, [engine.target, engine.phase, world, atlas, definition]);

  /* the target's pin/shape is marked "in focus" (renderer.ts draws a bigger, ringed pin
     for it under quizMode) purely from a Feature lookup — invisible, and harmless, for a
     Stage that never shows the map. */
  useEffect(() => {
    if (!world) return;
    const feature = engine.target ? world.byIso3.get(engine.target.iso3) ?? null : null;
    atlas?.setFocus(feature ? [feature] : []);
    setQuiz(prev => (prev ? { ...prev, target: feature } : prev));
  }, [engine.target, world, atlas, setQuiz]);

  useEffect(() => {
    setQuiz(prev =>
      prev
        ? { ...prev, answered: engine.answered, showNeighbours: engine.showNeighbours, paused: engine.phase === 'paused' }
        : prev
    );
  }, [engine.answered, engine.showNeighbours, engine.phase, setQuiz]);

  /** Live camera + target position for test/smoke.mjs — a function, not a snapshot, so it
   *  reads the camera as it is when called (after the fly-to has settled). DEV only. */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __zemyaView?: unknown }).__zemyaView = () => {
      const feature = engine.target && world ? world.byIso3.get(engine.target.iso3) : null;
      const place = feature && definition?.markCapital ? world?.places.find(m => m.feature === feature) : null;
      const view = atlas?.view;
      const canvas = document.querySelector('.stage__canvas')?.getBoundingClientRect();
      const dock = document.querySelector('.quiz-dock')?.getBoundingClientRect();
      return {
        camera: view ?? null,
        target: feature && atlas ? atlas.screenPosition(place?.ux ?? feature.ux, place?.uy ?? feature.uy) : null,
        canvas: canvas ? { left: canvas.left, top: canvas.top, right: canvas.right, bottom: canvas.bottom } : null,
        dockTop: dock ? dock.top : null
      };
    };
  }, [atlas, world, engine.target, definition]);

  /**
   * Test seam, mirroring ProgressProvider's `window.__zemya` — a separate global so it
   * never clobbers that one. `import.meta.env.DEV` makes this dead code in a production
   * build. test/smoke.mjs reads the current target's name from here rather than guessing
   * it from pixels, then asserts the NEXT target's name appears nowhere in the page — the
   * regression test for a quiz leaking an answer. `targetCapital` is the same for the
   * capitals quiz, whose answer is a city.
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __zemyaQuiz?: unknown }).__zemyaQuiz = {
      target: engine.target?.name ?? null,
      targetCapital: engine.target?.capital ?? null,
      answeredCount: engine.answeredCount,
      phase: engine.phase,
      elapsedMs: engine.elapsedMs
    };
  }, [engine.target, engine.answeredCount, engine.phase, engine.elapsedMs]);

  /* a scope key that has since been removed ("americas", split in two) lands on its
     replacement rather than a Not found page — old links and bookmarks keep working */
  if (subject && definition && params.scope && Object.hasOwn(LEGACY_SCOPES, params.scope)) {
    return <Navigate to={`/quizzes/${subject.id}/${definition.id}/${LEGACY_SCOPES[params.scope]}/${params.size ?? 'all'}`} replace />;
  }

  if (!subject || !definition || !scope || !requestedSize) {
    return (
      <>
        <header className="panel__head">
          <span className="panel__eyebrow">Quiz</span>
          <h2>Not found</h2>
        </header>
        <div className="panel__body">
          <div className="empty">
            <div className="empty__icon">?</div>
            <p>
              {!subject
                ? <>There is no subject called "{params.subject}".</>
                : !definition
                ? <>There is no quiz called "{params.quizId}" under {subject.name}.</>
                : <>There is no such scope or size: "{params.scope}/{params.size}".</>}
            </p>
          </div>
          <Link to={subject ? backTo : '/quizzes'} className="action">Back to quizzes</Link>
        </div>
      </>
    );
  }

  if (!world) {
    return (
      <>
        <header className="panel__head">
          <span className="panel__eyebrow">{definition.title}</span>
          <h2>Preparing…</h2>
        </header>
        <div className="panel__body">
          <div className="empty">
            <div className="empty__icon">🌍</div>
            <p>Loading the map.</p>
          </div>
        </div>
      </>
    );
  }

  if (!size) return <Navigate to={backTo} replace />;

  const { Stage } = definition;
  const revealed = engine.target ? engine.revealedSet.has(engine.target.iso3) : false;

  /* START (and "Run it again") focus the input SYNCHRONOUSLY, inside the tap: iOS opens the
     keyboard only for a focus() that happens within the user gesture itself. A focus in an
     effect or a timeout leaves the keyboard closed and the player stuck. The input is mounted
     (hidden) in every phase precisely so this has something to focus. `preventScroll` because
     iOS otherwise scrolls the page to "reveal" the input it is about to cover with a keyboard. */
  const startRun = () => {
    engine.inputRef.current?.focus({ preventScroll: true });
    engine.start();
  };

  const stageProps = {
    phase: engine.phase,
    target: engine.target,
    revealed,
    input: engine.input,
    onInputChange: engine.onInputChange,
    onInputKeyDown: engine.onInputKeyDown,
    inputRef: engine.inputRef,
    onStart: startRun,
    skip: engine.skip,
    reveal: engine.reveal,
    canSkip: engine.remainingCount >= 2,
    canReveal: Boolean(engine.target) && !revealed,
    showNeighbours: engine.showNeighbours,
    toggleShowNeighbours: engine.toggleShowNeighbours
  } as const;

  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">{definition.title} · {SCOPE_LABELS[scope]}</span>
        <h2>{countries.length} rounds</h2>
      </header>

      <div className="panel__body">
        {engine.phase === 'idle' && (
          <div className="empty">
            <div className="empty__icon">⌨</div>
            <p>
              <span className="only-fine">Press START — or Space, or Enter — to begin.</span>
              <span className="only-coarse">Tap START to begin.</span> Nothing is timed until you do.
            </p>
          </div>
        )}

        {(engine.phase === 'running' || engine.phase === 'paused') && (
          <>
            <div className="quiz-run__timer numeric">{formatDuration(engine.elapsedMs)}</div>
            <div className="quiz-run__count numeric">
              {engine.answeredCount} / {engine.totalCount}
            </div>

            {/* always present, empty when there is nothing to say — the buttons below it
                must not jump when a note appears or clears */}
            <div className="quiz-run__note-slot">
              {engine.lastNote && <div className="note">{engine.lastNote}</div>}
            </div>

            <div className="actions">
              <button type="button" className="action" onClick={engine.skip} disabled={engine.remainingCount < 2}>
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
              <button type="button" className="action" onClick={engine.togglePause}>
                {engine.phase === 'paused' ? 'Resume' : 'Pause'} <kbd>Esc</kbd>
              </button>
              <button type="button" className="action" onClick={engine.abandon}>
                Abandon <kbd>Ctrl+⌫</kbd>
              </button>
            </div>

            <Stage {...stageProps} slot="panel" />

            {engine.phase === 'paused' && (
              <div className="note">
                Paused — the timer is stopped.{' '}
                <span className="only-fine">Press Esc or Resume to continue.</span>
                <span className="only-coarse">Tap Resume to continue.</span>
              </div>
            )}
          </>
        )}

        {engine.phase === 'done' && engine.result && (
          <>
            <div className="hook">
              <div className="hook__label">Result</div>
              <p className="quiz-result__time numeric">{formatDuration(engine.result.timeMs)}</p>
              <p style={{ marginBottom: 6 }}>
                {engine.result.beatBest ? (
                  engine.result.previousBest !== null ? (
                    <>New personal best — beat <b>{formatDuration(engine.result.previousBest)}</b>.</>
                  ) : (
                    <>First run at this size — <b>{formatDuration(engine.result.timeMs)}</b> is now your personal best.</>
                  )
                ) : (
                  <>Personal best stays <b>{formatDuration(engine.result.previousBest ?? engine.result.timeMs)}</b>.</>
                )}
              </p>
              <p>
                <b>{engine.result.firstTryCount}</b> first-try, <b>{engine.result.revealed.length}</b> revealed
                {' '}(of {countries.length}).
              </p>
            </div>

            {engine.result.revealed.length > 0 && (
              <section>
                <h3 className="subhead">Revealed — the ones worth another look</h3>
                <div className="neighbours">
                  {engine.result.revealed.map((country: CountryRecord) => (
                    <Link className="neighbour" key={country.iso3} to={`/country/${country.slug}`}>
                      {country.emoji} {country.name}
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <div className="actions">
              <button type="button" className="action action--primary" onClick={startRun}>
                Run it again
              </button>
              <Link to={backTo} state={{ sheet: 'half' }} className="action">
                Back to quizzes
              </Link>
            </div>
          </>
        )}
      </div>

      <Stage {...stageProps} slot="stage" />

      {/* Phone layout only (`display: none` above the breakpoint): the run's own chrome, since the
          panel is hidden. Portalled to <body> — the panel is a transformed sheet, which would trap
          `position: fixed`. Thin HUD on top, the Stage's input bar at the bottom, the map (or
          flag) between; pause covers it with Resume and Abandon. */}
      {engine.phase !== 'done' && createPortal(
        <>
          <div className="quiz-hud" data-phase={engine.phase}>
            {engine.phase === 'idle' ? (
              <>
                <Link to={backTo} state={{ sheet: 'half' }} className="quiz-hud__back">‹ Quizzes</Link>
                <span className="quiz-hud__count numeric">{countries.length} rounds</span>
              </>
            ) : (
              <>
                <span className="quiz-hud__timer numeric">{formatDuration(engine.elapsedMs)}</span>
                <span className="quiz-hud__count numeric">
                  {engine.answeredCount} / {engine.totalCount}
                </span>
                <button
                  type="button"
                  className="quiz-hud__pause"
                  aria-label={engine.phase === 'paused' ? 'Resume' : 'Pause'}
                  onPointerDown={keepFocus}
                  onMouseDown={keepFocus}
                  onClick={engine.togglePause}
                >
                  <PauseIcon />
                </button>
              </>
            )}
          </div>
          {engine.phase === 'paused' && (
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
                onClick={engine.abandon}
              >
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
