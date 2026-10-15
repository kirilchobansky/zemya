/**
 * iOS/iPadOS "Done" hides the keyboard but can leave the input as the focused element, and a tap
 * on an already-focused input never raises the keyboard again. So when the keyboard goes away
 * during a run, the input is blurred (the next tap is then a fresh focus), and a tap anywhere on
 * the input bar that isn't a button focuses it again inside that gesture.
 */
import { useEffect, useRef, type RefObject } from 'react';

import { useKeyboard } from '~/shared/lib/keyboard';

export function useReopenKeyboard(inputRef: RefObject<HTMLInputElement | null>, active: boolean) {
  const { kb } = useKeyboard();
  const wasOpen = useRef(false);

  useEffect(() => {
    const closed = wasOpen.current && kb === 0;
    wasOpen.current = kb > 0;
    if (active && closed && document.activeElement === inputRef.current) inputRef.current?.blur();
  }, [kb, active, inputRef]);

  /** pointerdown on the bar's empty parts: focus the input within the tap. */
  return (e: { target: EventTarget; preventDefault(): void }) => {
    const input = inputRef.current;
    if (!active || !input || e.target === input) return;
    if (e.target instanceof Element && e.target.closest('button')) return;
    e.preventDefault();
    input.focus({ preventScroll: true });
  };
}
