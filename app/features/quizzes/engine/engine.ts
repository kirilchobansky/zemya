/**
 * The quiz engine: owns a run end-to-end — question order, the current target, attempt
 * state, timer accumulation, pause/resume, abandon, per-answer outcome (first-try /
 * skipped-then-got / revealed), completion, the results payload, the personal-best write
 * and FSRS grading.
 *
 * Deliberately ignorant of maps, flag images or anything else a Stage renders — it knows
 * a list of countries and a callback per answer. features/quizzes/pages/use-quiz-atlas-bridge.ts is what wires
 * this to the atlas (camera, quiz-mode map painting); this file must never import from
 * ~/engines/map or any component. See CLAUDE.md's Quizzes section.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

import { useProgress, saveQuizRun, makeRng, shuffle } from '~/features/progress';
import type { ReviewRating } from '~/features/progress';
import { cardId } from '~/features/countries';
import type { CountryRecord } from '~/engines/map/types';
import { EASY_MS, PREPARE_LOOKAHEAD, resolveMatch, type QuizEngine } from './engine-types';
import { scoreRun } from './run-result';
import { usePriorBest } from './use-prior-best';
import { inputKeyDownHandler, useQuizKeyboard } from './use-quiz-keyboard';
import { useQuizTimer } from './use-quiz-timer';
import type { QuizDefinition, QuizOutcome, QuizPhase, QuizRunResult } from './types';

export type { QuizEngine };

/** How long a revealed answer sits in the input before Enter's auto-fill accepts it. */
export const REVEAL_FILL_MS = 250;

export function useQuizEngine(
  definition: Pick<QuizDefinition, 'id' | 'facet' | 'match' | 'prepare' | 'answerOf'>,
  baseCountries: CountryRecord[],
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

  const { elapsedRef, segmentStartRef, elapsedMs, stopSegment } = useQuizTimer(phase);
  const inputRef = useRef<HTMLInputElement>(null);

  /** When each country most recently became the target, and which countries were ever
   *  skipped — read once per answer to grade the card and never rendered, so refs rather
   *  than state. */
  const shownAtRef = useRef<Map<string, number>>(new Map());
  const skippedRef = useRef<Set<string>>(new Set());

  /** Pending Enter-after-reveal fill: the answer is in the input and accepts itself shortly. */
  const fillTimerRef = useRef<number | null>(null);
  const cancelFill = useCallback(() => {
    if (fillTimerRef.current !== null) {
      window.clearTimeout(fillTimerRef.current);
      fillTimerRef.current = null;
    }
  }, []);

  /** The set a Restart drew; null = the route's own `baseCountries`. */
  const [runList, setRunList] = useState<CountryRecord[] | null>(null);
  const countries = runList ?? baseCountries;
  // a new base draw (another mode, scope, size) replaces whatever a Restart drew
  useEffect(() => setRunList(null), [baseCountries]);

  const [priorBest, setPriorBest] = usePriorBest(definition.id, scope, size);
  const [result, setResult] = useState<QuizRunResult | null>(null);


  const target = queue.length ? queue[0] : null;

  /* a different :scope, :size (or quiz) while this route stays mounted is a fresh run, not a
     continuation of the old one; toStart is the same reset, asked for by the panel's Up button */
  const toStart = useCallback(() => {
    setPhase('idle');
    setQueue([]);
    setRunList(null);
    setInput('');
    setRevealedSet(new Set());
    setAnswered(new Map());
    setLastNote(null);
    elapsedRef.current = 0;
    setResult(null);
    segmentStartRef.current = null;
    shownAtRef.current = new Map();
    skippedRef.current = new Set();
  }, []);
  useEffect(toStart, [definition.id, scope, size, toStart]);

  const begin = useCallback((list: CountryRecord[]) => {
    if (!list.length) return;
    cancelFill();
    const rng = makeRng(Date.now() ^ (Math.random() * 0xffffffff));
    const shuffled = shuffle(list, rng);
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
  }, [definition, cancelFill]);

  const start = useCallback(() => begin(countries), [begin, countries]);
  const restart = useCallback(
    (next?: CountryRecord[]) => {
      if (next) setRunList(next);
      begin(next ?? countries);
    },
    [begin, countries]
  );

  /* mark when the current target became visible, for the "answered fast" grading in
     onInputChange below */
  useEffect(() => {
    if (phase !== 'running' || !target) return;
    shownAtRef.current.set(target.iso3, Date.now());
  }, [phase, target]);

  const skip = useCallback(() => {
    if (phase !== 'running' || queue.length < 2) return;
    skippedRef.current.add(queue[0].iso3);
    setQueue(q => {
      const next = [...q.slice(1), q[0]];
      definition.prepare?.(next.slice(0, PREPARE_LOOKAHEAD));
      return next;
    });
    cancelFill();
    setInput('');
    setLastNote(null);
  }, [phase, queue, definition, cancelFill]);

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
     whatever was answered so far. onAbandon is the route's navigate('/quizzes/:subject');
     the route unmounting is what tears down whatever atlas/quiz integration it set up, so
     nothing here needs to reset local state first. */
  const abandon = useCallback(() => {
    onAbandon();
  }, [onAbandon]);

  /* Accepts the current target as answered — the one path for a typed match and for Enter's
     auto-fill, so scoring, the review rating and the next-question flow cannot drift apart. */
  const commitAnswer = useCallback(
    (note?: string) => {
      if (phase !== 'running' || !target) return;
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
      if (note) setLastNote(note);

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

      const { result: scored, firstTryCount, revealedCount } = scoreRun(countries, revealedSet, priorBest, finalElapsedMs);

      setResult(scored);
      setPriorBest(prev => (prev === null ? finalElapsedMs : Math.min(prev, finalElapsedMs)));
      saveQuizRun({
        quizId: definition.id,
        scope,
        size,
        timeMs: finalElapsedMs,
        totalCount: countries.length,
        firstTryCount,
        revealedCount,
        at: Date.now()
      });
    },
    [phase, target, definition, revealedSet, review, queue, stopSegment, countries, priorBest, scope, size]
  );

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      // ignored, not disabled, while paused — an actually-disabled <input> can't hold
      // keyboard focus at all, which is what made Esc-to-resume unreachable (see the
      // paused-Escape effect above)
      if (phase !== 'running' || !target) return;
      cancelFill(); // typing takes over from a pending auto-fill
      const value = e.target.value;
      setInput(value);
      if (lastNote) setLastNote(null);

      const outcome = resolveMatch(value, target, definition);
      if (outcome.accepted) commitAnswer(outcome.note);
    },
    [phase, target, definition, lastNote, commitAnswer, cancelFill]
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
      commitAnswer();
    }, REVEAL_FILL_MS);
  }, [phase, target, revealedSet, definition, commitAnswer]);

  /* A pending fill belongs to one target of one running phase: pause, a new target or
     unmounting drops it. (commitAnswer clears the timer itself via the target change.) */
  useEffect(() => cancelFill, [phase, target, cancelFill]);

  const onInputKeyDown = useCallback(inputKeyDownHandler(skip, reveal, fillRevealed), [skip, reveal, fillRevealed]);

  useQuizKeyboard({ phase, start, togglePause, abandon, skip, reveal, fillRevealed, inputRef, queue, revealedSet });

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
    restart,
    skip,
    reveal,
    togglePause,
    abandon,
    toStart,
    onInputChange,
    onInputKeyDown,
    inputRef
  };
}
