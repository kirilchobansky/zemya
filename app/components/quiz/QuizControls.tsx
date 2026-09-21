/**
 * The typed-answer input every quiz shares, plus — on phones — the two buttons that stand in for
 * the keyboard shortcuts (Skip = Tab, Reveal = Ctrl+Enter). Both Stages render this, inside
 * their own docking element, so the input attributes and the phone rules live in one place.
 *
 * Phone rules (CLAUDE.md "Mobile"):
 *  - The input is the SAME element from idle through the results. START must call
 *    `input.focus()` synchronously inside its tap — iOS only opens the keyboard for focus that
 *    happens within the gesture — and an input that only mounts after the phase changes
 *    can't be focused there. Idle and done render it hidden (`--idle`).
 *  - The attributes stop iOS "correcting" an answer: "Chad" must not become "Chat".
 *  - The buttons never take focus from the input (pointerdown is cancelled), so tapping Skip
 *    doesn't close the keyboard. The input itself is never blurred between questions.
 *  - Desktop: `.quiz-controls` and `.quiz-dock__row` are `display: contents` and the buttons are
 *    `display: none`, so the layout is exactly what it was before this existed.
 */
import type { ReactNode } from 'react';

import type { QuizStageProps } from '~/lib/quiz/types';

/** Keeps focus where it is: a tap on a control must not move it off the input. */
const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

export function SkipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 5.5v13l9-6.5-9-6.5Z" />
      <path d="M18.5 5.5v13" />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

interface QuizControlsProps {
  stage: Pick<
    QuizStageProps,
    'phase' | 'input' | 'onInputChange' | 'onInputKeyDown' | 'inputRef' | 'skip' | 'reveal' | 'canSkip' | 'canReveal'
  >;
  placeholder: string;
  ariaLabel: string;
  /** The revealed answer, shown in the reserved slot above the input — null until revealed. */
  answer: ReactNode;
}

export function QuizControls({ stage, placeholder, ariaLabel, answer }: QuizControlsProps) {
  const { phase, input, onInputChange, onInputKeyDown, inputRef, skip, reveal, canSkip, canReveal } = stage;
  const active = phase === 'running' || phase === 'paused';

  return (
    <div className="quiz-controls" data-phase={phase}>
      {active && <div className="quiz-feedback">{answer ? <div className="quiz-dock__answer">{answer}</div> : null}</div>}
      <div className="quiz-dock__row">
        <input
          ref={inputRef}
          // NOT the `disabled` attribute while paused — a disabled element can't hold keyboard
          // focus, which is exactly what broke Esc-to-resume. Paused input is ignored in the
          // engine's onInputChange instead; this is purely visual.
          className={`quiz-dock__input${phase === 'paused' ? ' quiz-dock__input--paused' : ''}${active ? '' : ' quiz-dock__input--idle'}`}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="text"
          enterKeyHint="done"
          tabIndex={active ? undefined : -1}
          aria-hidden={active ? undefined : true}
          value={input}
          onChange={onInputChange}
          onKeyDown={onInputKeyDown}
          placeholder={phase === 'paused' ? 'Paused' : placeholder}
          aria-label={ariaLabel}
        />
        {active && (
          <>
            <button
              type="button"
              className="quiz-dock__btn"
              aria-label="Skip"
              disabled={!canSkip}
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={skip}
            >
              <SkipIcon />
            </button>
            <button
              type="button"
              className="quiz-dock__btn"
              aria-label="Reveal the answer"
              disabled={!canReveal}
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={reveal}
            >
              <EyeIcon />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export { keepFocus };
