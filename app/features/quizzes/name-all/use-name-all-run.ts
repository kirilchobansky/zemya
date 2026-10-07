/**
 * State and logic of one "Name all countries" run: phase, the named list, the timer and
 * pause, matching typed names (with the short auto-accept window), finishing and saving,
 * restart, give up, and the window keys. No JSX; the screen is NameAllQuiz.tsx.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

import { matchCountryName, normaliseName, type QuizScope, type prepareCountryNames } from '~/features/countries';
import { bestQuizTime, saveQuizRun } from '~/features/progress';
import { NAME_ALL_ID } from '~/features/quizzes/geography/quizzes';
import type { CountryRecord } from '~/engines/map/types';
import { AUTO_ACCEPT_MS, NO_NAMED, type Outcome, type Phase } from './name-all-types';

export function useNameAllRun({ scope, ready, total, prepared, byIso3, leave }: {
  scope: QuizScope;
  ready: boolean;
  total: number;
  prepared: ReturnType<typeof prepareCountryNames>;
  byIso3: ReadonlyMap<string, CountryRecord>;
  /** Abandon: leave the run for the quiz list, nothing saved (Ctrl+Backspace). */
  leave: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [paused, setPaused] = useState(false);
  const [named, setNamed] = useState<readonly string[]>(NO_NAMED);
  const [input, setInput] = useState('');
  const [hint, setHint] = useState('');
  const [shaking, setShaking] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [priorBest, setPriorBest] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listEndRef = useRef<HTMLLIElement | null>(null);
  // refs so two events in one tick (a fast typist, an instant accept then Enter) never read stale state
  const namedRef = useRef<readonly string[]>(NO_NAMED);
  const namedSetRef = useRef<ReadonlySet<string>>(new Set());
  const phaseRef = useRef<Phase>('idle');
  const pausedRef = useRef(false);
  const startedAtRef = useRef(0);
  const elapsedRef = useRef(0);
  phaseRef.current = phase;

  const running = phase === 'running';
  const active = running; // the input takes answers
  const finished = phase === 'done' || phase === 'gaveup';

  useEffect(() => {
    let cancelled = false;
    bestQuizTime(NAME_ALL_ID, scope, 'all').then(best => { if (!cancelled) setPriorBest(best); });
    return () => { cancelled = true; };
  }, [scope]);

  useEffect(() => {
    if (!running || paused) return;
    const tick = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 100);
    return () => clearInterval(tick);
  }, [running, paused]);

  /* ------------------------------------------------------------------ run */

  const finish = useCallback((next: 'done' | 'gaveup', timeMs: number) => {
    pausedRef.current = false;
    setPaused(false);
    setElapsedMs(timeMs);
    phaseRef.current = next;
    setPhase(next);
    setInput('');
    setHint('');
    if (next !== 'done') return;
    const beatBest = priorBest === null || timeMs < priorBest;
    setOutcome({ beatBest, previousBest: priorBest });
    setPriorBest(prev => (prev === null ? timeMs : Math.min(prev, timeMs)));
    saveQuizRun({
      quizId: NAME_ALL_ID, scope, size: 'all', timeMs,
      totalCount: total, firstTryCount: total, revealedCount: 0, at: Date.now()
    });
  }, [priorBest, scope, total]);

  const accept = useCallback((index: number, already: boolean) => {
    const country = byIso3.get(prepared[index].iso3);
    setInput('');
    if (already) { // a repeat is a hint, not an error
      setHint(`Already named${country ? `: ${country.name}` : ''}`);
      return;
    }
    setHint('');
    const next = [...namedRef.current, prepared[index].iso3];
    namedRef.current = next;
    namedSetRef.current = new Set(next);
    setNamed(next);
    if (next.length === total) finish('done', Date.now() - startedAtRef.current);
  }, [byIso3, prepared, total, finish]);

  /* START focuses the input SYNCHRONOUSLY, inside the tap — iOS opens the keyboard only for a
     focus() made within the gesture itself. */
  const startRun = () => {
    if (phaseRef.current !== 'idle' || !ready) return;
    inputRef.current?.focus({ preventScroll: true });
    startedAtRef.current = Date.now();
    phaseRef.current = 'running';
    setPhase('running');
  };

  const giveUp = () => {
    if (phaseRef.current !== 'running') return;
    finish('gaveup', pausedRef.current ? elapsedRef.current : Date.now() - startedAtRef.current);
  };

  /* Restart: back to the start screen, nothing saved. */
  const restart = () => {
    pausedRef.current = false;
    setPaused(false);
    namedRef.current = NO_NAMED;
    namedSetRef.current = new Set();
    setNamed(NO_NAMED);
    setInput('');
    setHint('');
    setOutcome(null);
    elapsedRef.current = 0;
    setElapsedMs(0);
    phaseRef.current = 'idle';
    setPhase('idle');
  };

  const togglePause = useCallback(() => {
    if (phaseRef.current !== 'running') return;
    if (pausedRef.current) startedAtRef.current = Date.now() - elapsedRef.current;
    else elapsedRef.current = Date.now() - startedAtRef.current;
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    if (pausedRef.current) setElapsedMs(elapsedRef.current);
  }, []);

  /* An exact name that is also the start of a longer, still unnamed one ("niger" / "nigeria",
     "dominica" / "dominican republic", "uk" / "ukraine") is filled at once, like any other, and
     the input clears at once. The text is remembered for AUTO_ACCEPT_MS: a key that continues it
     toward a longer open name restores it and carries on; any other key starts fresh. */
  const acceptTimerRef = useRef<number | null>(null);
  const leftoverRef = useRef('');
  const cancelAccept = useCallback(() => {
    if (acceptTimerRef.current !== null) window.clearTimeout(acceptTimerRef.current);
    acceptTimerRef.current = null;
  }, []);
  useEffect(() => cancelAccept, [cancelAccept]);
  useEffect(() => { if (paused || !active) { cancelAccept(); leftoverRef.current = ''; } }, [paused, active, cancelAccept]);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!active || pausedRef.current) return;
    cancelAccept();
    let value = e.target.value;
    const leftover = leftoverRef.current;
    leftoverRef.current = '';
    if (leftover && value) {
      const joined = leftover + value;
      const squashed = normaliseName(joined).replace(/ /g, '');
      const leads = matchCountryName(joined, prepared, namedSetRef.current) !== null ||
        prepared.some(p => !namedSetRef.current.has(p.iso3) && p.forms.some(f => f.startsWith(squashed)));
      if (leads) value = joined;
    }
    setHint('');
    const match = matchCountryName(value, prepared, namedSetRef.current);
    if (match && !match.typo && (match.instant || !match.already)) {
      accept(match.index, match.already);
      if (!match.instant) {
        leftoverRef.current = value; // the input is cleared at once; the text is only remembered
        acceptTimerRef.current = window.setTimeout(() => {
          acceptTimerRef.current = null;
          leftoverRef.current = '';
        }, AUTO_ACCEPT_MS);
      }
      return;
    }
    setInput(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !active || pausedRef.current) return;
    e.preventDefault();
    cancelAccept();
    const match = matchCountryName(input, prepared, namedSetRef.current);
    if (match) accept(match.index, match.already);
    else if (input.trim()) setShaking(true); // nothing is cleared and nothing is penalised
  };

  /* Window keys. Idle: Space or Enter starts (the input is hidden, so it can't carry them).
     Running: Esc pauses, Ctrl+Backspace abandons, and a printable key aimed at anything that
     isn't a text field refocuses the input — the browser then delivers the character to it. */
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing) return;
      if (phase === 'idle') {
        if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); startRun(); }
        return;
      }
      if (phase !== 'running') return;
      if (e.key === 'Escape') { e.preventDefault(); togglePause(); return; }
      if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); leave(); return; }
      const el = e.target as Element | null;
      if (el?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
      if (e.ctrlKey || e.altKey || e.metaKey || pausedRef.current) return;
      if (e.key.length === 1 || e.key === 'Backspace') inputRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // startRun and leave read only refs and stable values; re-binding per render would add nothing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, phase, togglePause]);

  useEffect(() => {
    if (running) inputRef.current?.focus({ preventScroll: true });
  }, [running]);

  /* the newest name stays in view in the list */
  useEffect(() => {
    if (running) listEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [named.length, running]);

  /* Test seam, like engine.ts's: DEV only, dead code in a production build. */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __zemyaQuiz?: unknown }).__zemyaQuiz = { phase, answeredCount: named.length, elapsedMs };
  }, [phase, named.length, elapsedMs]);

  return {
    phase, paused, named, input, hint, shaking, setShaking, elapsedMs, outcome,
    running, finished, inputRef, listEndRef, namedSetRef,
    startRun, restart, giveUp, togglePause, onChange, onKeyDown
  };
}
