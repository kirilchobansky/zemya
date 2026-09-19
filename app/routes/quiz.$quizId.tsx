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
import { useQuizEngine } from '~/lib/quiz/engine';
import { formatDuration } from '~/lib/format';
import { quizDefinition, topByPopulation } from '~/lib/geography/quizzes';
import { isQuizScope, isQuizSize, LEGACY_SCOPES, poolForScope, SCOPE_LABELS, sizesForPool, type QuizSize } from '~/lib/geography/scopes';
import { loadWorld } from '~/lib/geography/world';
import type { CountryRecord, World } from '~/lib/map/types';

export function meta({ params }: { params: { quizId?: string } }) {
  const definition = params.quizId ? quizDefinition(params.quizId) : undefined;
  if (!definition) return [{ title: 'Quiz — Zemya' }];
  return [
    { title: `${definition.title} — Zemya` },
    { name: 'description', content: definition.description }
  ];
}

export default function QuizRun() {
  const navigate = useNavigate();
  const params = useParams<{ quizId: string; scope: string; size: string }>();
  const definition = params.quizId ? quizDefinition(params.quizId) : undefined;
  const scope = params.scope && isQuizScope(params.scope) ? params.scope : null;
  const requestedSize = params.size && isQuizSize(params.size) ? params.size : null;

  const { atlas, setQuiz } = useAtlasContext();

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

  const abandon = () => navigate('/quiz');
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
  useEffect(() => {
    setQuiz({ target: null, answered: new Map(), showNeighbours: false, paused: false });
    return () => {
      setQuiz(null);
      atlasRef.current?.setFocus([]); // don't leave a random country's pin permanently enlarged
    };
  }, [setQuiz]);

  /* little to no zoom, on purpose — the run stays at (roughly) the world view the whole
     time, so a target is found by its highlight (or, for a quiz whose Stage doesn't use
     the map at all, isn't found on the map at all) rather than the camera flying to it;
     see CLAUDE.md's Quizzes section. Watches phase transitions rather than running once
     per render. */
  const prevPhaseRef = useRef(engine.phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    if (prev !== 'running' && engine.phase === 'running') atlas?.home();
    if (prev !== 'done' && engine.phase === 'done') {
      atlas?.home();
      atlas?.setFocus([]);
    }
    prevPhaseRef.current = engine.phase;
  }, [engine.phase, atlas]);

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

  /**
   * Test seam, mirroring ProgressProvider's `window.__zemya` — a separate global so it
   * never clobbers that one. `import.meta.env.DEV` makes this dead code in a production
   * build. test/smoke.mjs reads the current target's name from here rather than guessing
   * it from pixels, then asserts the NEXT target's name appears nowhere in the page — the
   * regression test for a quiz leaking an answer.
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __zemyaQuiz?: unknown }).__zemyaQuiz = {
      target: engine.target?.name ?? null,
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
              <Link to="/quiz" className="action">
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
