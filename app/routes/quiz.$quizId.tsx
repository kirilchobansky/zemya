/**
 * One route for every quiz — /quiz/:quizId/:scope/:size — looked up by id in
 * app/lib/geography/quizzes.ts's QUIZ_DEFINITIONS. All the run logic (queue, timer,
 * pause/resume, abandon, grading, results, personal best) lives in the shared engine
 * (app/lib/quiz/engine.ts), which knows nothing about the map. This file is the "atlas
 * bridge": it owns the handful of things every quiz needs from the atlas layout — hiding
 * the search box/toolbar/tooltip for the run's whole lifetime, returning the camera to the
 * world view on START and on finish, and mirroring the run's target/answered/neighbour
 * state into the map's own quiz-mode painting (harmless, if invisible, for a quiz whose
 * Stage doesn't use the map at all — see the flags quiz). Only the *visual* per-question
 * experience — what's drawn where, using what input layout — is left to the quiz's own
 * Stage component. See CLAUDE.md's Quizzes section.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';

import { useAtlasContext } from './atlas';
import { allCountries } from '~/lib/geography/catalog.server';
import { quizPageSeo } from '~/lib/geography/quizSeo';
import { pageMeta } from '~/lib/seo';
import type { Route } from './+types/quiz.$quizId';
import { useQuizEngine } from '~/lib/quiz/engine';
import { formatDuration } from '~/lib/format';
import { quizDefinition, topByPopulation } from '~/lib/geography/quizzes';
import { isQuizScope, isQuizSize, LEGACY_SCOPES, poolForScope, SCOPE_LABELS, SCOPE_VIEWS, sizesForPool, type QuizSize } from '~/lib/geography/scopes';
import { loadWorld } from '~/lib/geography/world';
import { NO_INSETS, type Insets } from '~/lib/map/follow';
import type { CountryRecord, World } from '~/lib/map/types';

/** What the docked quiz input covers of the canvas, so a target hidden under it counts as
 *  not visible. The right-hand panel is a grid column BESIDE the stage, not over it, so a
 *  country "behind the panel" is simply off the canvas and needs no inset. */
function measureInsets(): Insets {
  const canvas = document.querySelector('.stage__canvas');
  const dock = document.querySelector('.quiz-dock');
  if (!canvas || !dock) return NO_INSETS;
  const c = canvas.getBoundingClientRect();
  const d = dock.getBoundingClientRect();
  return { ...NO_INSETS, bottom: Math.max(0, c.bottom - d.top) };
}

/** Build-time only: the size of the scope's pool, which the title says ("All 46 Countries")
 *  and which only the catalogue knows. */
export function loader({ params }: Route.LoaderArgs) {
  const scope = params.scope ?? '';
  return { poolSize: isQuizScope(scope) ? poolForScope(allCountries(), scope).length : 0 };
}

export function meta({ params, loaderData, location }: Route.MetaArgs) {
  const definition = params.quizId ? quizDefinition(params.quizId) : undefined;
  const { scope = '', size = '' } = params;
  if (!definition || !isQuizScope(scope) || !isQuizSize(size)) {
    return pageMeta({ title: 'Quiz — Zemya', description: 'A timed geography quiz.', path: location.pathname, noindex: true });
  }
  return pageMeta({
    ...quizPageSeo(definition, scope, size, loaderData?.poolSize ?? 0),
    path: location.pathname
  });
}

export default function QuizRun() {
  const navigate = useNavigate();
  const params = useParams<{ quizId: string; scope: string; size: string }>();
  const definition = params.quizId ? quizDefinition(params.quizId) : undefined;
  const scope = params.scope && isQuizScope(params.scope) ? params.scope : null;
  const requestedSize = params.size && isQuizSize(params.size) ? params.size : null;

  const { atlas, setQuiz, setImmersive, setSheetSnap } = useAtlasContext();

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

  const abandon = () => navigate('/quiz', { state: { sheet: 'half' } });
  const engine = useQuizEngine(
    definition ?? { id: 'unknown', facet: 'location' },
    countries,
    scope ?? 'world',
    requestedSize ?? 'all',
    abandon
  );

  /* quiz mode covers the whole lifetime of this route, not just the running phase — the
     map should already be in its stripped-down, full-screen state on the START (idle)
     screen. Torn down on unmount so leaving /quiz/:quizId restores the normal map.
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
  if (definition && params.scope && Object.hasOwn(LEGACY_SCOPES, params.scope)) {
    return <Navigate to={`/quiz/${definition.id}/${LEGACY_SCOPES[params.scope]}/${params.size ?? 'all'}`} replace />;
  }

  if (!definition || !scope || !requestedSize) {
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
              {!definition
                ? <>There is no quiz called "{params.quizId}".</>
                : <>There is no such scope or size: "{params.scope}/{params.size}".</>}
            </p>
          </div>
          <Link to="/quiz" className="action">Back to quizzes</Link>
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

  if (!size) return <Navigate to="/quiz" replace />;

  const { Stage } = definition;
  const revealed = engine.target ? engine.revealedSet.has(engine.target.iso3) : false;
  const stageProps = {
    phase: engine.phase,
    target: engine.target,
    revealed,
    input: engine.input,
    onInputChange: engine.onInputChange,
    onInputKeyDown: engine.onInputKeyDown,
    inputRef: engine.inputRef,
    onStart: engine.start,
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
            <p>Press START — or Space, or Enter — to begin. Nothing is timed until you do.</p>
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
              <div className="note">Paused — the timer is stopped. Press Esc or Resume to continue.</div>
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
              <button type="button" className="action action--primary" onClick={engine.start}>
                Run it again
              </button>
              <Link to="/quiz" state={{ sheet: 'half' }} className="action">
                Back to quizzes
              </Link>
            </div>
          </>
        )}
      </div>

      <Stage {...stageProps} slot="stage" />
    </>
  );
}
