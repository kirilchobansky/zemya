/**
 * "Name the Flag"'s Stage: no map. The flag takes over the whole stage area — dark
 * background, the flag centred and large in a FIXED-size box, the typed-answer input below
 * it at a constant position, focused. Nothing else on screen names a country. The right panel (timer, count,
 * skip/reveal/pause/abandon, and the accepted-confusable-pair note) is entirely the
 * generic engine/route scaffold — this Stage renders nothing into the panel slot. See
 * CLAUDE.md's Quizzes section.
 */
import { createPortal } from 'react-dom';

import { Flag } from '~/components/Flag';
import type { QuizStageProps } from '~/lib/quiz/types';

export function FlagsStage(props: QuizStageProps) {
  const { slot, phase, target, revealed, input, onInputChange, onInputKeyDown, inputRef, onStart } = props;

  if (slot === 'panel') return null;
  if (phase === 'done') return null;

  // Portalled to <body> for the same reason as MapStage's dock: a transformed sheet ancestor
  // would trap this `position: fixed` stage inside the panel on phones.
  return createPortal(
    <div className="quiz-flag-stage">
      {phase === 'idle' && (
        <button type="button" className="quiz-dock__start" onClick={onStart}>
          START
        </button>
      )}
      {(phase === 'running' || phase === 'paused') && target && (
        <>
          <div className="quiz-flag-stage__flag">
            <Flag iso2={target.iso2} emoji={target.emoji} flagRatio={target.flagRatio} size="xl" alt="" />
          </div>
          <div className="quiz-feedback">
            {revealed && <div className="quiz-dock__answer">{target.name}</div>}
          </div>
          <input
            ref={inputRef}
            // NOT the `disabled` attribute while paused — see CountriesStage's own note;
            // paused input is ignored in the engine's onInputChange, this is only visual.
            className={`quiz-dock__input${phase === 'paused' ? ' quiz-dock__input--paused' : ''}`}
            type="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={input}
            onChange={onInputChange}
            onKeyDown={onInputKeyDown}
            placeholder={phase === 'paused' ? 'Paused' : 'Which country is this?'}
            aria-label="Which country is this?"
          />
        </>
      )}
    </div>,
    document.body
  );
}
