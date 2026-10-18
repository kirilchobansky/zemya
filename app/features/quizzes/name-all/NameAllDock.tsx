import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';

import { keepFocus } from '~/features/quizzes/engine/QuizControls';
import { StartCaption } from '~/features/quizzes/engine/StartCaption';
import type { Phase } from './name-all-types';

/** The docked input (desktop) / input bar on the keyboard (phone), with START while idle.
 *  Rendered in every phase so START has an input to focus. The caller portals it to <body>. */
export function NameAllDock({ phase, ready, paused, hint, input, shaking, inputRef, onChange, onKeyDown, onShakeEnd, onStart, onGiveUp }: {
  phase: Phase;
  ready: boolean;
  paused: boolean;
  hint: string;
  input: string;
  shaking: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onShakeEnd: () => void;
  onStart: () => void;
  onGiveUp: () => void;
}) {
  const running = phase === 'running';
  const ctlPhase = phase === 'running' ? (paused ? 'paused' : 'running') : phase === 'idle' ? 'idle' : 'done';
  return (
    <div className="quiz-dock" data-phase={ctlPhase}>
      {phase === 'idle' && ready && (
        <>
          <button type="button" className="quiz-dock__start" onClick={onStart}>START</button>
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
            onAnimationEnd={onShakeEnd}
            placeholder={paused ? 'Paused' : 'Type a country — Enter to confirm'}
            aria-label="Type a country"
          />
          {running && (
            <button
              type="button"
              className="quiz-dock__btn quiz-dock__btn--text"
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={onGiveUp}
            >
              Give up
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
