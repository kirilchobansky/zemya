/**
 * The window- and document-level shortcuts of a run: Space/Enter starts, Esc pauses,
 * Ctrl+Backspace abandons, and the typing capture that keeps the keyboard working after a
 * click on the map. The input's own onKeyDown stays in engine.ts.
 */
import { useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

import type { QuizPhase } from './types';

export interface QuizKeyboardActions {
  phase: QuizPhase;
  start(): void;
  togglePause(): void;
  abandon(): void;
  skip(): void;
  reveal(): void;
  fillRevealed(): void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Only here to re-run the focus effect when the target or a reveal changes. */
  queue: readonly unknown[];
  revealedSet: ReadonlySet<string>;
}

export function useQuizKeyboard({ phase, start, togglePause, abandon, skip, reveal, fillRevealed, inputRef, queue, revealedSet }: QuizKeyboardActions): void {
  /* Initial focus, and belt-and-braces refocus after a phase change. NOT what keeps typing
     working — a canvas click blurs the input without changing phase, so this alone left the
     rest of the run dead to the keyboard. The document-level capture below is the guarantee. */
  useEffect(() => {
    if (phase === 'running' || phase === 'paused') inputRef.current?.focus();
  }, [phase, queue, revealedSet]);

  /* Space or Enter also starts a run — the input doesn't exist yet to carry a keydown
     handler while idle, so this is the one shortcut that has to live on the window. */
  useEffect(() => {
    if (phase !== 'idle') return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        start();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, start]);

  /* Esc toggles pause, Ctrl+Backspace abandons — both live on the window, not the input's
     own onKeyDown. The input used to be given the `disabled` attribute while paused,
     which also silently drops keyboard focus (a disabled element can't be focused at
     all), so a second Esc, aimed at resuming, reached no handler and the run looked
     stuck; a global listener means pausing can never strand its own resume shortcut.
     Ctrl+Backspace (not a bare key) so it can never fire while actually typing a
     country's name — a bare letter would collide with typing e.g. "Qatar". */
  useEffect(() => {
    if (phase !== 'running' && phase !== 'paused') return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        togglePause();
      } else if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        abandon();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, togglePause, abandon]);

  /* Typing capture. While a run is going, a keystroke aimed at ANYTHING that isn't a text
     field belongs to the quiz: focus the input and let the keystroke land in it. It fails
     exactly when the player is fastest otherwise — drag the map, tap ⌂, and the very next
     letter used to vanish.
       - We focus during keydown and do NOT preventDefault: the browser delivers the
         character to whatever is focused when the default action runs, i.e. the input, so
         the first letter is not lost and React's onChange sees it as an ordinary keystroke
         (verified by typing a whole name from an unfocused state — see tests/e2e/smoke.mjs).
       - Ctrl/Alt/Meta held: not typing, ignored — except Ctrl+Enter (reveal), below.
       - Tab (skip) and Ctrl+Enter (reveal) only reach the input's own onKeyDown when the
         input has focus; with focus elsewhere (a button just clicked) Tab would walk the
         page instead, so they are handled here too. When the input DOES have focus this
         listener returns first, so nothing fires twice. Esc and Ctrl+Backspace are
         window-level already (above). */
  useEffect(() => {
    if (phase !== 'running') return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing) return;
      const el = e.target as Element | null;
      if (el?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;

      if (e.key === 'Enter' && e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        reveal();
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      // a focused button/link keeps its own Enter (activating it)
      if (e.key === 'Enter' && !el?.closest?.('button, a')) {
        e.preventDefault();
        fillRevealed();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        skip();
        return;
      }
      if (e.key.length === 1 || e.key === 'Backspace') inputRef.current?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [phase, skip, reveal, fillRevealed]);
}

/* Escape is deliberately not handled here — it's a window-level listener above, so
   pausing can never leave itself with no focused, enabled element to resume from. */
export function inputKeyDownHandler(skip: () => void, reveal: () => void, fillRevealed: () => void) {
  return (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      skip();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      reveal();
    } else if (e.key === 'Enter') {
      // A phone's "done" key would otherwise dismiss the keyboard; it fills in a revealed
      // answer, and otherwise has no meaning — answers are accepted the instant they match.
      e.preventDefault();
      fillRevealed();
    }
  };
}
