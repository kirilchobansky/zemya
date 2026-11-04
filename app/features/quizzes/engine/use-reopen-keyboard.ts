/**
 * iOS/iPadOS "Done" hides the keyboard but can leave the input as the focused element, and a tap
 * on an already-focused input never raises the keyboard again. So when the keyboard goes away
 * during a run (every quiz input: the geography runs, Name all countries, the history fill list), the input is blurred (the next tap is then a fresh focus), and a tap anywhere on
 * the input bar that isn't a button focuses it again inside that gesture.
 */
import { useEffect, useRef, type RefObject } from 'react';

import { useKeyboard } from '~/shared/lib/keyboard';

export function useReopenKeyboard(inputRef: RefObject<HTMLInputElement | null>, active: boolean) {
  const { open } = useKeyboard();
  const wasOpen = useRef(false);

  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (active && closed && document.activeElement === inputRef.current) inputRef.current?.blur();
  }, [open, active, inputRef]);

  /** pointerdown on the bar's empty parts: focus the input within the tap. */
  return (e: { target: EventTarget; preventDefault(): void }) => {
    const input = inputRef.current;
    if (!active || !input || e.target === input) return;
    if (e.target instanceof Element && e.target.closest('button')) return;
    e.preventDefault();
    input.focus({ preventScroll: true });
  };
}
