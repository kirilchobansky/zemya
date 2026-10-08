/**
 * State and logic of one "fill the list" run: phase, the toggle, the grid's entries, the
 * timer and pause, accepting a typed name, finishing (and saving) and restarting. The screen
 * itself is HistoryFillQuiz.tsx; this hook has no JSX.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

import { useAtlasContext } from '~/features/map';
import { bestQuizTime, saveQuizRun } from '~/features/progress';
import { useKeyboard, useQuizPageLock } from '~/shared/lib/keyboard';
import {
  entriesFor, hasMixedTitles, matchFill, needsNumber, prepareFill, type FillQuiz
} from './fill-quiz';
import { toggleSize } from './fill-quiz-config';
import { NO_FILLED, type Outcome, type Phase } from './fill-run-types';

export function useFillRun(quiz: FillQuiz) {
  useQuizPageLock(true);
  useKeyboard(); // publishes --kb / --vv-top, which size the phone screen to what the keyboard leaves
  const { setQuiz, setImmersive } = useAtlasContext();
  const [phase, setPhase] = useState<Phase>('idle');
  /* The quiz's toggle, as currently chosen. The finished run keeps the setting it was played
     with (`runToggle`) while the result screen lets the player pick the next one. */
  const [toggleOn, setToggleOn] = useState(false);
  const [byColumns, setByColumns] = useState(true);
  const [runToggle, setRunToggle] = useState(false);
  const shownToggle = phase === 'idle' || phase === 'running' ? toggleOn : runToggle;
  const entries = useMemo(() => entriesFor(quiz, shownToggle), [quiz, shownToggle]);
  const prepared = useMemo(() => prepareFill(entries), [entries]);
  const total = entries.length;
  const showTitles = useMemo(() => hasMixedTitles(entries), [entries]);
  const size = toggleSize(quiz.toggle !== null && toggleOn);

  const [filled, setFilled] = useState<ReadonlySet<string>>(NO_FILLED);
  const [input, setInput] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [shaking, setShaking] = useState(false);
  const [hint, setHint] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [priorBest, setPriorBest] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [host, setHost] = useState<Element | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  // refs so two events in one tick (a fast typist, an instant accept then Enter) never read stale state
  const filledRef = useRef<ReadonlySet<string>>(NO_FILLED);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const phaseRef = useRef<Phase>('idle');
  const startedAtRef = useRef(0);
  const elapsedRef = useRef(0);
  phaseRef.current = phase;

  useEffect(() => {
    setHost(document.querySelector('main.stage'));
    setMounted(true);
  }, []);

  /* The map behind the panel goes into quiz mode (search box, toolbar and tooltips hidden,
     names off) exactly as for a geography run; a phone run owns the whole screen. */
  useEffect(() => {
    setQuiz({ target: null, answered: new Map(), showNeighbours: false, showCapital: false, paused: false });
    setImmersive(true);
    return () => {
      setQuiz(null);
      setImmersive(false);
    };
  }, [setQuiz, setImmersive]);

  useEffect(() => {
    let cancelled = false;
    bestQuizTime(quiz.id, 'all', size).then(best => { if (!cancelled) setPriorBest(best); });
    return () => { cancelled = true; };
  }, [quiz.id, size]);

  useEffect(() => {
    if (phase !== 'running' || paused) return;
    const tick = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 100);
    return () => clearInterval(tick);
  }, [phase, paused]);

  /* Esc pauses and resumes a started run. Window-level and the input is never disabled, so
     the key always has somewhere to land (same reasoning as the geography engine). */
  const togglePause = useCallback(() => {
    if (phaseRef.current !== 'running') return;
    if (pausedRef.current) startedAtRef.current = Date.now() - elapsedRef.current;
    else elapsedRef.current = Date.now() - startedAtRef.current;
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    if (pausedRef.current) setElapsedMs(elapsedRef.current);
  }, []);
  useEffect(() => {
    if (phase !== 'running') return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, togglePause]);

  const active = phase === 'idle' || phase === 'running';
  /* Typing capture, as in the geography quizzes: a keystroke aimed at anything that isn't a text
     field (after a click on the page, a button, the timeline) belongs to the quiz. Focus moves
     during keydown without preventDefault, so the browser delivers the character to the input. */
  useEffect(() => {
    if (!active) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
      if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
      if (e.key.length === 1 || e.key === 'Backspace') inputRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);
  useEffect(() => {
    if (active) inputRef.current?.focus({ preventScroll: true });
    else inputRef.current?.blur();
  }, [active, mounted]);

  const finish = useCallback((next: Phase, timeMs: number) => {
    pausedRef.current = false;
    setPaused(false);
    setElapsedMs(timeMs);
    setRunToggle(toggleOn);
    setPhase(next);
    if (next !== 'done') return;
    const beatBest = priorBest === null || timeMs < priorBest;
    setOutcome({ timeMs, beatBest, previousBest: priorBest });
    setPriorBest(prev => (prev === null ? timeMs : Math.min(prev, timeMs)));
    saveQuizRun({
      quizId: quiz.id, scope: 'all', size, timeMs,
      totalCount: total, firstTryCount: total, revealedCount: 0, at: Date.now()
    });
  }, [priorBest, quiz.id, size, toggleOn, total]);

  const accept = useCallback((index: number) => {
    const next = new Set(filledRef.current).add(prepared[index].id);
    filledRef.current = next;
    setFilled(next);
    setInput('');
    setHint(false);
    if (next.size === total) finish('done', Date.now() - startedAtRef.current);
  }, [prepared, total, finish]);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!active || pausedRef.current) return;
    const value = e.target.value;
    setHint(false);
    if (phaseRef.current === 'idle' && value.trim()) {
      startedAtRef.current = Date.now();
      phaseRef.current = 'running';
      setPhase('running');
    }
    const match = matchFill(value, prepared, filledRef.current);
    if (match && match.instant && !match.typo) accept(match.index);
    else setInput(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !active || pausedRef.current) return;
    e.preventDefault();
    const match = matchFill(input, prepared, filledRef.current);
    if (match) accept(match.index);
    else if (input.trim()) { // nothing is cleared and nothing is penalised
      setShaking(true);
      setHint(needsNumber(input, prepared, filledRef.current));
    }
  };

  const giveUp = () => {
    if (!active) return;
    finish('gaveup', phase === 'running' ? (pausedRef.current ? elapsedRef.current : Date.now() - startedAtRef.current) : 0);
  };

  /* Synchronous focus inside the tap — iOS opens the keyboard only for a focus() made inside
     the gesture itself. */
  const restart = () => {
    pausedRef.current = false;
    setPaused(false);
    filledRef.current = NO_FILLED;
    phaseRef.current = 'idle';
    setFilled(NO_FILLED);
    setInput('');
    setHint(false);
    setElapsedMs(0);
    setOutcome(null);
    setPhase('idle');
    inputRef.current?.focus({ preventScroll: true });
  };

  // No Up step: the top Back leaves for the country's quiz list at any time, mid-run included
  // (an abandon, nothing saved).


  const revealing = phase === 'gaveup';
  const missed = total - filled.size;
  const finished = phase === 'done' || phase === 'gaveup';

  return {
    phase, phaseRef, paused, toggleOn, setToggleOn, byColumns, setByColumns, runToggle,
    entries, total, showTitles, filled, input, elapsedMs, shaking, setShaking, hint, outcome,
    mounted, host, inputRef, active, revealing, missed, finished,
    togglePause, onChange, onKeyDown, giveUp, restart
  };
}
