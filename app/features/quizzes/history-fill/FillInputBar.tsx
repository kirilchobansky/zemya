import type { ChangeEvent, KeyboardEvent, MutableRefObject, RefObject } from 'react';

import { keepFocus } from '~/features/quizzes/engine/QuizControls';
import type { Phase } from './fill-run-types';

/** The always-focused input at the top of the run screen, with Give up and (while running)
 *  Restart. Never `disabled`: when a run ends it is just moved out of sight. */
export function FillInputBar({ active, phase, phaseRef, inputRef, input, shaking, onShakeEnd, onChange, onKeyDown, onGiveUp, onRestart }: {
  active: boolean;
  phase: Phase;
  phaseRef: MutableRefObject<Phase>;
  inputRef: RefObject<HTMLInputElement | null>;
  input: string;
  shaking: boolean;
  onShakeEnd: () => void;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onGiveUp: () => void;
  onRestart: () => void;
}) {
  return (
  <div className={`fill-quiz__bar${active ? '' : ' fill-quiz__bar--off'}`}>
    <input
      ref={inputRef}
      className={`fill-quiz__input${shaking ? ' is-shaking' : ''}`}
      type="text"
      value={input}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onAnimationEnd={onShakeEnd}
      onBlur={e => {
        // Stay focused unless focus went to another control (Tab to Give up still works).
        if (phaseRef.current !== 'idle' && phaseRef.current !== 'running') return;
        if (e.relatedTarget) return;
        requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
      }}
      placeholder="Type a name to start"
      aria-label="Type a name"
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="done"
    />
    <button
      type="button"
      className="action fill-quiz__giveup"
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={onGiveUp}
    >
      Give up
    </button>
    {/* only while a run is active (running or paused), and exactly "Try again" */}
    {phase === 'running' && (
      <button
        type="button"
        className="action fill-quiz__restart"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={onRestart}
      >
        Restart
      </button>
    )}
  </div>
  );
}
