/**
 * "Name the Country"'s Stage. The map itself stays fully visible and interactive — the
 * generic atlas bridge in routes/quiz.$quizId.tsx is what paints the target brass and
 * answered countries green/amber, moves the camera to the world view on START, and hides
 * the search box and hover tooltip for every quiz alike (see CLAUDE.md's Quizzes
 * section). This component only renders the floating START button / typed-answer input /
 * revealed-answer chip docked over the canvas, plus its own neighbour-glow toggle in the
 * panel slot — the one piece of "today's behaviour" that is genuinely this quiz's own,
 * since no other quiz has a notion of map neighbours.
 */
import type { QuizStageProps } from '~/lib/quiz/types';

export function CountriesStage(props: QuizStageProps) {
  const {
    slot, phase, target, revealed, input, onInputChange, onInputKeyDown, inputRef, onStart,
    showNeighbours, toggleShowNeighbours
  } = props;

  if (slot === 'panel') {
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

  return (
    <div className="quiz-dock">
      {phase === 'idle' && (
        <button type="button" className="quiz-dock__start" onClick={onStart}>
          START
        </button>
      )}
      {(phase === 'running' || phase === 'paused') && (
        <>
          {target && revealed && <div className="quiz-dock__answer">{target.name}</div>}
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
            placeholder={phase === 'paused' ? 'Paused' : "Type the country's name…"}
            aria-label="Type the country's name"
          />
        </>
      )}
    </div>
  );
}
