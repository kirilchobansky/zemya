/**
 * One geography quiz run (/quizzes/:subject/:quizId/:scope/:size): composes the run's data,
 * the shared engine (app/features/quizzes/engine/engine.ts, which knows nothing about the
 * map), the atlas bridge and the views — the panel, the quiz's own Stage (map / flag /
 * outline), the desktop pause screen and the phone HUD.
 */
import { listReturnState } from '~/features/map';
import { createPortal } from "react-dom";
import { Link, Navigate } from "react-router";

import { LEGACY_SCOPES, SCOPE_LABELS } from '~/features/countries';
import { StageClock } from '../engine/StageClock';
import { useQuizEngine } from '../engine/engine';
import { selectQuizCountries } from '../geography/quizzes';
import { QuizRunHud } from './QuizRunHud';
import { QuizRunPanel } from './QuizRunPanel';
import { useQuizAtlasBridge } from './use-quiz-atlas-bridge';
import { useQuizRunData } from './use-quiz-run-data';
import { useQuizTestSeams } from './use-quiz-test-seams';
import '~/features/quizzes/engine/quiz-run.css';

export function QuizRun() {
  const {
    go, params, subject, definition, scope, requestedSize, backTo, mode,
    stageHost, world, pool, size, drawnCountries, countries, setRedraw
  } = useQuizRunData();

  const abandon = () => go(backTo, { state: listReturnState(window.location.pathname), replace: true });
  const engine = useQuizEngine(
    definition ?? { id: "unknown", facet: "location" },
    drawnCountries,
    scope ?? "world",
    requestedSize ?? "all",
    abandon,
  );

  useQuizAtlasBridge({ engine, definition, scope, requestedSize, size, world });
  useQuizTestSeams({ engine, definition, world });

  /* a scope key that has since been removed ("americas", split in two) lands on its
     replacement rather than a Not found page — old links and bookmarks keep working */
  if (
    subject &&
    definition &&
    params.scope &&
    Object.hasOwn(LEGACY_SCOPES, params.scope)
  ) {
    return (
      <Navigate
        to={`/quizzes/${subject.id}/${definition.id}/${LEGACY_SCOPES[params.scope]}/${params.size ?? "all"}`}
        replace
      />
    );
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
              {!subject ? (
                <>There is no subject called "{params.subject}".</>
              ) : !definition ? (
                <>
                  There is no quiz called "{params.quizId}" under {subject.name}
                  .
                </>
              ) : (
                <>
                  There is no such scope or size: "{params.scope}/{params.size}
                  ".
                </>
              )}
            </p>
          </div>
          <Link to={subject ? backTo : "/quizzes"} replace className="action">
            Back to quizzes
          </Link>
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
  const revealed = engine.target
    ? engine.revealedSet.has(engine.target.iso3)
    : false;

  /* START (and "Run it again") focus the input SYNCHRONOUSLY, inside the tap: iOS opens the
     keyboard only for a focus() that happens within the user gesture itself. A focus in an
     effect or a timeout leaves the keyboard closed and the player stuck. The input is mounted
     (hidden) in every phase precisely so this has something to focus. `preventScroll` because
     iOS otherwise scrolls the page to "reveal" the input it is about to cover with a keyboard. */
  const startRun = () => {
    engine.inputRef.current?.focus({ preventScroll: true });
    engine.start();
  };

  /* Restart (active run only): a NEW run on a NEWLY DRAWN set of the same size, scope and mode
     (random draws differ; population / Top-N and "all" come back as the same set), waiting on
     the start screen. Nothing is saved or graded. */
  const restartRun = () => {
    const next = selectQuizCountries(pool, size, mode);
    setRedraw({ from: drawnCountries, list: next });
    engine.toStart();
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
    toggleShowNeighbours: engine.toggleShowNeighbours,
    world,
    pool,
  } as const;

  const panelStage = <Stage {...stageProps} slot="panel" />;

  return (
    <>
      <QuizRunPanel
        engine={engine} definition={definition} scope={scope} countries={countries} revealed={revealed}
        backTo={backTo} panelStage={panelStage} onRestart={restartRun} onRunAgain={engine.toStart}
      />

      <Stage {...stageProps} slot="stage" />
      {(engine.phase === "running" || engine.phase === "paused") && (
        <StageClock host={stageHost} ms={engine.elapsedMs} />
      )}

      {/* Desktop pause: covers the stage (map / flag / outline), so a pause can't be used to
          study the target; the panel stays clickable for Resume. Phone has .quiz-pause below. */}
      {engine.phase === "paused" && stageHost &&
        createPortal(
          <div className="quiz-pause-desk" role="dialog" aria-label="Paused">
            <p className="quiz-pause__title">Paused</p>
            <p className="quiz-pause__sub">The timer is stopped.</p>
            <button type="button" className="action action--primary" onClick={engine.togglePause}>
              Resume <kbd>Esc</kbd>
            </button>
          </div>,
          stageHost,
        )}

      {/* Phone layout only (`display: none` above the breakpoint): the run's own chrome, since the
          panel is hidden. Portalled to <body> — the panel is a transformed sheet, which would trap
          `position: fixed`. Thin HUD on top, the Stage's input bar at the bottom, the map (or
          flag) between; pause covers it with Resume and Abandon. */}
      {engine.phase !== "done" &&
        createPortal(
          <QuizRunHud engine={engine} total={countries.length} backTo={backTo} onRestart={restartRun} />,
          document.body,
        )}
    </>
  );
}
