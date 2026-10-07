/**
 * The run clock. Elapsed time is accumulated in refs (never state), so "continue from where
 * it was" on resume cannot be skewed by when a setState is applied; a 200 ms tick state only
 * forces the re-render that moves the live timer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { QuizPhase } from './types';

export function useQuizTimer(phase: QuizPhase) {
  // A ref, not state: the timer's own math must never depend on when a setState happens
  // to be applied/batched — a plain ref mutation is immediate and synchronous, so
  // "continue from where it was" on resume can't be skewed by render timing.
  const elapsedRef = useRef(0);
  const [tick, setTick] = useState(0); // forces a re-render so the live timer moves
  const segmentStartRef = useRef<number | null>(null);

  /* live timer tick while running; frozen (not just visually — elapsedRef itself stops
     growing) the instant the run is paused or finishes */
  useEffect(() => {
    if (phase !== 'running') return;
    const id = window.setInterval(() => setTick(t => t + 1), 200);
    return () => window.clearInterval(id);
  }, [phase]);
  void tick;

  const elapsedMs =
    elapsedRef.current + (segmentStartRef.current ? Date.now() - segmentStartRef.current : 0);

  const stopSegment = useCallback(() => {
    if (segmentStartRef.current !== null) {
      elapsedRef.current += Date.now() - segmentStartRef.current;
      segmentStartRef.current = null;
    }
  }, []);

  return { elapsedRef, segmentStartRef, elapsedMs, stopSegment };
}
