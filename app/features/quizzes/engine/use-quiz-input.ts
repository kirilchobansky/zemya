/**
 * The typed answer of a run: each keystroke resolved against the target, and Enter on a revealed
 * answer (filled in, then accepted). Owns the pending-fill timer, which other run actions cancel.
 */
import { useCallback, useEffect, useRef, type ChangeEvent, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { CountryRecord } from '~/engines/map/types';
import { resolveMatch } from './engine-types';
import type { QuizDefinition, QuizPhase } from './types';

/** How long a revealed answer sits in the input before Enter's auto-fill accepts it. */
export const REVEAL_FILL_MS = 250;

export function useQuizInput({ phase, target, revealedSet, definition, lastNote, setInput, setLastNote, commitRef }: {
  phase: QuizPhase;
  target: CountryRecord | null;
  revealedSet: ReadonlySet<string>;
  definition: Pick<QuizDefinition, 'match' | 'answerOf'>;
  lastNote: string | null;
  setInput: Dispatch<SetStateAction<string>>;
  setLastNote: Dispatch<SetStateAction<string | null>>;
  /** The engine's commitAnswer, kept current by the engine. */
  commitRef: MutableRefObject<(note?: string) => void>;
}) {
  /** Pending Enter-after-reveal fill: the answer is in the input and accepts itself shortly. */
  const fillTimerRef = useRef<number | null>(null);
  const cancelFill = useCallback(() => {
    if (fillTimerRef.current !== null) {
      window.clearTimeout(fillTimerRef.current);
      fillTimerRef.current = null;
    }
  }, []);

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      // ignored, not disabled, while paused — an actually-disabled <input> can't hold
      // keyboard focus at all, which is what made Esc-to-resume unreachable (see the
      // paused-Escape effect in use-quiz-keyboard.ts)
      if (phase !== 'running' || !target) return;
      cancelFill(); // typing takes over from a pending auto-fill
      const value = e.target.value;
      setInput(value);
      if (lastNote) setLastNote(null);

      const outcome = resolveMatch(value, target, definition);
      if (outcome.accepted) commitRef.current(outcome.note);
    },
    [phase, target, definition, lastNote, cancelFill, setInput, setLastNote, commitRef]
  );

  /* Plain Enter on a revealed answer: put the answer text in the input for REVEAL_FILL_MS,
     then accept it as a normal answer (outcome "revealed" — the target is in revealedSet). The
     answer is accepted by construction, not re-matched: the reveal string (e.g. all the
     languages, or "Euro (EUR)") is not necessarily something the matcher takes. Enter with
     nothing revealed does nothing. */
  const fillRevealed = useCallback(() => {
    if (phase !== 'running' || !target || !revealedSet.has(target.iso3)) return;
    if (fillTimerRef.current !== null) return; // already filling
    setInput(definition.answerOf ? definition.answerOf(target) : target.name);
    fillTimerRef.current = window.setTimeout(() => {
      fillTimerRef.current = null;
      commitRef.current();
    }, REVEAL_FILL_MS);
  }, [phase, target, revealedSet, definition, setInput, commitRef]);

  /* A pending fill belongs to one target of one running phase: pause, a new target or
     unmounting drops it. (commitAnswer clears the timer itself via the target change.) */
  useEffect(() => cancelFill, [phase, target, cancelFill]);

  return { cancelFill, onInputChange, fillRevealed };
}
