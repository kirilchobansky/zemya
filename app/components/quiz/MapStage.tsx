/**
 * The map-based quizzes' shared Stage — "Name the Country" and "Name the Capital" are the
 * same screen (a docked START button, a typed-answer input and a revealed-answer chip over
 * the live canvas) differing only in what is typed and what a reveal shows, which is what
 * `MapStageConfig` carries. CountriesStage.tsx and CapitalsStage.tsx are the two configs.
 *
 * Originally "Name the Country"'s Stage. The map itself stays fully visible and interactive — the
 * generic atlas bridge in routes/quiz.$quizId.tsx is what paints the target brass and
 * answered countries green/amber, moves the camera to the world view on START, and hides
 * the search box and hover tooltip for every quiz alike (see CLAUDE.md's Quizzes
 * section). This component only renders the floating START button / typed-answer input /
 * revealed-answer chip docked over the canvas, plus its own neighbour-glow toggle in the
 * panel slot — the one piece of "today's behaviour" that is genuinely this quiz's own,
 * since no other quiz has a notion of map neighbours.
 */
import { createPortal } from 'react-dom';

import type { CountryRecord } from '~/lib/map/types';
import type { QuizStageProps } from '~/lib/quiz/types';

export interface MapStageConfig {
  /** Input placeholder while running. */
  placeholder: string;
  /** Accessible name of the input. */
  ariaLabel: string;
  /** What a reveal (Ctrl+Enter) shows for the current target — the ANSWER, so it must
   *  only ever be rendered once `revealed` is true. */
  answerOf(target: CountryRecord): string;
  /** The countries quiz's own neighbour-glow toggle in the panel slot. The capitals quiz
   *  has no use for it: its target country is already highlighted. */
  neighbourToggle: boolean;
}

export function MapStage(props: QuizStageProps & { config: MapStageConfig }) {
  const {
    config,
    slot, phase, target, revealed, input, onInputChange, onInputKeyDown, inputRef, onStart,
    showNeighbours, toggleShowNeighbours
  } = props;

  if (slot === 'panel') {
    if (!config.neighbourToggle) return null;
    if (phase !== 'running' && phase !== 'paused') return null;
    return (
      <button
        type="button"
        className="tool"
        style={{ alignSelf: 'flex-start' }}
        aria-pressed={showNeighbours}
        onClick={toggleShowNeighbours}
      >
        Neighbour glow
      </button>
    );
  }

  if (phase === 'done') return null;

  // Portalled to <body>: on phones the panel that renders this route is a transformed bottom
  // sheet, and a transformed ancestor becomes the containing block of `position: fixed`
  // descendants — the dock would be pinned inside the sheet instead of to the screen.
  return createPortal(
    <div className="quiz-dock">
      {phase === 'idle' && (
        <button type="button" className="quiz-dock__start" onClick={onStart}>
          START
        </button>
      )}
      {(phase === 'running' || phase === 'paused') && (
        <>
          <div className="quiz-feedback">
            {target && revealed && <div className="quiz-dock__answer">{config.answerOf(target)}</div>}
          </div>
          <input
            ref={inputRef}
            // NOT the `disabled` attribute while paused — a disabled element can't hold
            // keyboard focus, which is exactly what broke Esc-to-resume. Paused input is
            // ignored in the engine's onInputChange instead; this is purely visual.
            className={`quiz-dock__input${phase === 'paused' ? ' quiz-dock__input--paused' : ''}`}
            type="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={input}
            onChange={onInputChange}
            onKeyDown={onInputKeyDown}
            placeholder={phase === 'paused' ? 'Paused' : config.placeholder}
            aria-label={config.ariaLabel}
          />
        </>
      )}
    </div>,
    document.body
  );
}
