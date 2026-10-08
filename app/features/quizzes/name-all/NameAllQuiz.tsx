/**
 * "Name all countries" — the run screen of the free-recall geography quiz (rules in
 * docs/quizzes.md, matching in app/features/countries/names.ts's `matchCountryName`). No prompt: the
 * player types country names in any order and each correct one joins a list, in the order named,
 * and is coloured on the map. It doesn't use the geography engine (app/features/quizzes/engine/engine.ts) —
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
import { listReturnState } from '~/features/map';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useGo } from '~/shared/lib/navigation';

import { type QuizScope } from '~/features/countries';
import { StageClock } from '~/features/quizzes/engine/StageClock';
import { useKeyboard } from '~/shared/lib/keyboard';
import type { CountryRecord } from '~/engines/map/types';
import { NameAllDock } from './NameAllDock';
import { NameAllHud } from './NameAllHud';
import { NameAllPanel } from './NameAllPanel';
import { useResultsInspect } from '~/features/quizzes/engine/use-results-inspect';
import { useRestoreFinishedRun } from '~/features/quizzes/engine/use-results-return';
import { useNameAllAtlas } from './use-name-all-atlas';
import { useNameAllRun } from './use-name-all-run';
import { useNameAllWorld } from './use-name-all-world';
import '~/features/quizzes/engine/quiz-run.css';
import './NameAllQuiz.css';

export function NameAllQuiz({ scope, backTo }: { scope: QuizScope; backTo: string }) {
  const keyboard = useKeyboard(); // publishes --kb / --vv-top, which size the phone screen to what the keyboard leaves
  const go = useGo();
  const { stageHost, mounted, pool, prepared, byIso3, total, ready } = useNameAllWorld(scope);

  const leave = () => go(backTo, { state: listReturnState(window.location.pathname), replace: true });
  const run = useNameAllRun({ scope, ready, total, prepared, byIso3, leave });
  const {
    phase, paused, named, input, hint, shaking, setShaking, elapsedMs, outcome, running, finished,
    inputRef, listEndRef, namedSetRef, startRun, restart, giveUp, togglePause, onChange, onKeyDown, snapshot, restoreResult
  } = run;
  useRestoreFinishedRun(ready, phase === 'idle', restoreResult); // Back from a dossier opened off the results

  useNameAllAtlas({
    scope, phase, paused, named, pool, ready,
    keyboardStrip: `${keyboard.kb}:${keyboard.top}:${keyboard.height}`, inputRef
  });

  useResultsInspect(finished, snapshot, phase); // names, hover and a click to the dossier once it is over

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

  return (
    <>
      <NameAllPanel
        scope={scope} backTo={backTo} ready={ready} phase={phase} paused={paused} total={total}
        hint={hint} elapsedMs={elapsedMs} named={named} namedCountries={namedCountries} missed={missed}
        outcome={outcome} listEndRef={listEndRef}
        onTogglePause={togglePause} onRestart={restart} onGiveUp={giveUp} onLeave={leave} snapshot={snapshot}
      />

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
          <NameAllDock
            phase={phase} ready={ready} paused={paused} hint={hint} input={input} shaking={shaking}
            inputRef={inputRef} onChange={onChange} onKeyDown={onKeyDown}
            onShakeEnd={() => setShaking(false)} onStart={startRun} onGiveUp={giveUp}
          />
          <NameAllHud
            phase={phase} paused={paused} finished={finished} backTo={backTo} total={total}
            namedCount={named.length} elapsedMs={elapsedMs}
            onLeave={leave} onTogglePause={togglePause} onRestart={restart} onGiveUp={giveUp}
          />
        </>,
        document.body
      )}
    </>
  );
}
