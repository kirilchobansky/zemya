/**
 * The quiz engine: owns a run end-to-end — question order, the current target, attempt
 * state, timer accumulation, pause/resume, abandon, per-answer outcome (first-try /
 * skipped-then-got / revealed), completion, the results payload, the personal-best write
 * and FSRS grading.
 *
 * Deliberately ignorant of maps, flag images or anything else a Stage renders — it knows
 * a list of countries and a callback per answer. routes/quiz.$quizId.tsx is what wires
 * this to the atlas (camera, quiz-mode map painting); this file must never import from
 * ~/lib/map or ~/components. See CLAUDE.md's Quizzes section.
 */
import {
  useCallback, useEffect, useRef, useState,
  type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject
} from 'react';

import { useProgress } from '~/lib/core/ProgressProvider';
import { bestQuizTime, saveQuizRun } from '~/lib/core/progress';
import { makeRng, shuffle } from '~/lib/core/questions';
import type { ReviewRating } from '~/lib/core/scheduler';
import { cardId } from '~/lib/geography/mastery';
import { matchesCountry } from '~/lib/geography/names';
import type { CountryRecord } from '~/lib/map/types';
import type { MatchOutcome, QuizDefinition, QuizOutcome, QuizPhase, QuizRunResult } from './types';

/** Grading thresholds mapped onto FSRS's four ratings — see CLAUDE.md's Quizzes section. */
const EASY_MS = 5000;

/** How many upcoming targets (current + lookahead) a definition's prepare() sees — enough
 *  for the flags quiz to preload the heaviest SVGs (200+ KB) before they're needed. */
const PREPARE_LOOKAHEAD = 3;

export interface QuizEngine {
  phase: QuizPhase;
  target: CountryRecord | null;
  input: string;
  revealedSet: ReadonlySet<string>;
  answered: ReadonlyMap<string, QuizOutcome>;
  answeredCount: number;
  totalCount: number;
  /** Countries still unanswered, current target included — queue.length, without exposing
   *  the queue itself. Skip is only meaningful with at least one country besides it. */
  remainingCount: number;
  /** Live — moves every ~200ms while running, frozen while paused or done. */
  elapsedMs: number;
  showNeighbours: boolean;
  toggleShowNeighbours(): void;
  /** Set when the last accepted answer came through a definition's `match` exception
   *  (see the flags quiz's confusable pairs) rather than the plain name match — cleared
   *  as soon as the player starts typing the next answer. */
  lastNote: string | null;
  result: QuizRunResult | null;
  priorBest: number | null;
  start(): void;
  skip(): void;
  reveal(): void;
  togglePause(): void;
  abandon(): void;
  onInputChange(e: ChangeEvent<HTMLInputElement>): void;
  onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>): void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/** Resolves one keystroke against the target: the definition's own `match` first (for a
 *  quiz's special-case acceptances), falling back to the plain name match everyone gets
 *  for free — see names.ts's own "no fuzzy matching" doc comment for why that fallback is
 *  exact, not fuzzy. */
function resolveMatch(
  typed: string,
  target: CountryRecord,
  definition: Pick<QuizDefinition, 'match'>
): MatchOutcome {
  return definition.match?.(typed, target) ?? { accepted: matchesCountry(typed, target) };
}

export function useQuizEngine(
  definition: Pick<QuizDefinition, 'id' | 'facet' | 'match' | 'prepare'>,
  countries: CountryRecord[],
  scope: string,
  size: string,
  onAbandon: () => void
): QuizEngine {
  const { review } = useProgress();

  const [phase, setPhase] = useState<QuizPhase>('idle');
  const [queue, setQueue] = useState<CountryRecord[]>([]);
  const [input, setInput] = useState('');
  const [revealedSet, setRevealedSet] = useState<ReadonlySet<string>>(new Set());
  const [answered, setAnswered] = useState<ReadonlyMap<string, QuizOutcome>>(new Map());
  const [showNeighbours, setShowNeighbours] = useState(false);
  const [lastNote, setLastNote] = useState<string | null>(null);

  // A ref, not state: the timer's own math must never depend on when a setState happens
  // to be applied/batched — a plain ref mutation is immediate and synchronous, so
  // "continue from where it was" on resume can't be skewed by render timing.
  const elapsedRef = useRef(0);
  const [tick, setTick] = useState(0); // forces a re-render so the live timer moves
  const segmentStartRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** When each country most recently became the target, and which countries were ever
   *  skipped — read once per answer to grade the card and never rendered, so refs rather
   *  than state. */
  const shownAtRef = useRef<Map<string, number>>(new Map());
  const skippedRef = useRef<Set<string>>(new Set());

  const [priorBest, setPriorBest] = useState<number | null>(null);
  const [result, setResult] = useState<QuizRunResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    bestQuizTime(definition.id, scope, size).then(best => { if (!cancelled) setPriorBest(best); });
    return () => { cancelled = true; };
  }, [definition.id, scope, size]);

  const target = queue.length ? queue[0] : null;

  /* a different :scope, :size (or quiz) while this route stays mounted is a fresh run, not a
     continuation of the old one */
  useEffect(() => {
    setPhase('idle');
    setQueue([]);
    setInput('');
    setRevealedSet(new Set());
    setAnswered(new Map());
    setLastNote(null);
    elapsedRef.current = 0;
    setResult(null);
    segmentStartRef.current = null;
    shownAtRef.current = new Map();
    skippedRef.current = new Set();
  }, [definition.id, scope, size]);

  const start = useCallback(() => {
    if (!countries.length) return;
    const rng = makeRng(Date.now() ^ (Math.random() * 0xffffffff));
    const shuffled = shuffle(countries, rng);
    setQueue(shuffled);
    setInput('');
    setRevealedSet(new Set());
    setAnswered(new Map());
    setLastNote(null);
    elapsedRef.current = 0;
    setResult(null);
    shownAtRef.current = new Map();
    skippedRef.current = new Set();
    segmentStartRef.current = Date.now();
    setPhase('running');
    definition.prepare?.(shuffled.slice(0, PREPARE_LOOKAHEAD));
  }, [countries, definition]);

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

  /* mark when the current target became visible, for the "answered fast" grading in
     onInputChange below */
  useEffect(() => {
    if (phase !== 'running' || !target) return;
    shownAtRef.current.set(target.iso3, Date.now());
  }, [phase, target]);

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

  const skip = useCallback(() => {
    if (phase !== 'running' || queue.length < 2) return;
    skippedRef.current.add(queue[0].iso3);
    setQueue(q => {
      const next = [...q.slice(1), q[0]];
      definition.prepare?.(next.slice(0, PREPARE_LOOKAHEAD));
      return next;
    });
    setInput('');
    setLastNote(null);
  }, [phase, queue, definition]);

  const reveal = useCallback(() => {
    if (phase !== 'running' || !target) return;
    setRevealedSet(s => (s.has(target.iso3) ? s : new Set(s).add(target.iso3)));
  }, [phase, target]);

  const togglePause = useCallback(() => {
    if (phase === 'running') {
      stopSegment();
      setPhase('paused');
    } else if (phase === 'paused') {
      segmentStartRef.current = Date.now();
      setPhase('running');
    }
  }, [phase, stopSegment]);

  /* Abandon: quit the run outright, nothing saved — no quizRuns row, no FSRS grading for
     whatever was answered so far. onAbandon is the route's navigate('/quiz'); the route
     unmounting is what tears down whatever atlas/quiz integration it set up, so nothing
     here needs to reset local state first. */
  const abandon = useCallback(() => {
    onAbandon();
  }, [onAbandon]);

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

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      // ignored, not disabled, while paused — an actually-disabled <input> can't hold
      // keyboard focus at all, which is what made Esc-to-resume unreachable (see the
      // paused-Escape effect above)
      if (phase !== 'running' || !target) return;
      const value = e.target.value;
      setInput(value);
      if (lastNote) setLastNote(null);

      const outcome = resolveMatch(value, target, definition);
      if (!outcome.accepted) return;

      const iso3 = target.iso3;
      const wasRevealed = revealedSet.has(iso3);
      const wasSkipped = skippedRef.current.has(iso3);
      const elapsed = Date.now() - (shownAtRef.current.get(iso3) ?? Date.now());

      /* Feed the spaced repetition: this is the point of having built FSRS. Playing a
         quiz schedules the countries you don't know for review in study mode. See
         CLAUDE.md's Quizzes section. */
      const rating: ReviewRating =
        wasRevealed ? 'again' : wasSkipped ? 'hard' : elapsed < EASY_MS ? 'easy' : 'good';
      review(cardId(iso3, definition.facet), rating);

      const answerOutcome: QuizOutcome = wasRevealed ? 'revealed' : 'correct';
      setAnswered(prev => {
        const next = new Map(prev);
        next.set(iso3, answerOutcome);
        return next;
      });
      setInput('');
      if (outcome.note) setLastNote(outcome.note);

      const remaining = queue.slice(1);
      setQueue(remaining);
      if (remaining.length) {
        definition.prepare?.(remaining.slice(0, PREPARE_LOOKAHEAD));
        return;
      }

      // computed from the refs directly, not the render-scope elapsedMs — refs are
      // always current, but this closure could otherwise be stale
      const finalElapsedMs =
        elapsedRef.current + (segmentStartRef.current ? Date.now() - segmentStartRef.current : 0);
      stopSegment();
      setPhase('done');

      const revealedCountries = countries.filter(c => revealedSet.has(c.iso3));
      const firstTryCount = countries.length - revealedCountries.length;
      const beatBest = priorBest === null || finalElapsedMs < priorBest;

      setResult({ timeMs: finalElapsedMs, firstTryCount, revealed: revealedCountries, beatBest, previousBest: priorBest });
      setPriorBest(prev => (prev === null ? finalElapsedMs : Math.min(prev, finalElapsedMs)));
      saveQuizRun({
        quizId: definition.id,
        scope,
        size,
        timeMs: finalElapsedMs,
        totalCount: countries.length,
        firstTryCount,
        revealedCount: revealedCountries.length,
        at: Date.now()
      });
    },
    [phase, target, definition, revealedSet, review, queue, stopSegment, countries, priorBest, scope, size, lastNote]
  );

  /* Escape is deliberately not handled here — it's a window-level listener above, so
     pausing can never leave itself with no focused, enabled element to resume from. */
  const onInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        skip();
      } else if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        reveal();
      }
    },
    [skip, reveal]
  );

  /* the input must never need the mouse to regain focus — refocus after every state
     change that could plausibly have moved it (a new question, a reveal, pausing,
     resuming). Kept focused while paused too — Esc is a window-level listener, but
     there's no reason to drop focus just because typing is ignored. */
  useEffect(() => {
    if (phase === 'running' || phase === 'paused') inputRef.current?.focus();
  }, [phase, queue, revealedSet]);

  const toggleShowNeighbours = useCallback(() => setShowNeighbours(v => !v), []);

  return {
    phase,
    target,
    input,
    revealedSet,
    answered,
    answeredCount: answered.size,
    totalCount: countries.length,
    remainingCount: queue.length,
    elapsedMs,
    showNeighbours,
    toggleShowNeighbours,
    lastNote,
    result,
    priorBest,
    start,
    skip,
    reveal,
    togglePause,
    abandon,
    onInputChange,
    onInputKeyDown,
    inputRef
  };
}
