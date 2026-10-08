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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useProgress, makeRng, shuffle } from '~/features/progress';
import type { ReviewRating } from '~/features/progress';
import { cardId } from '~/features/countries';
import type { CountryRecord } from '~/engines/map/types';
import type { FinishedRun } from './finished-runs';
import { EASY_MS, PREPARE_LOOKAHEAD, type QuizEngine } from './engine-types';
import { archiveRun, scoreRun, settledMarks } from './run-result';
import { usePriorBest } from './use-prior-best';
import { useQuizInput, REVEAL_FILL_MS } from './use-quiz-input';
import { inputKeyDownHandler, useQuizKeyboard } from './use-quiz-keyboard';
import { useQuizReview } from './use-quiz-review';
import { useQuizTimer } from './use-quiz-timer';
import type { QuizDefinition, QuizOutcome, QuizPhase } from './types';

export type { QuizEngine };

export { REVEAL_FILL_MS };

export function useQuizEngine(
  definition: Pick<QuizDefinition, 'id' | 'facet' | 'match' | 'prepare' | 'answerOf'>,
  baseCountries: CountryRecord[],
  scope: string,
  size: string,
  mode: string,
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

  /** The set a Restart drew; null = the route's own `baseCountries`. */
  const [runList, setRunList] = useState<CountryRecord[] | null>(null);
  const countries = runList ?? baseCountries;
  // a new base draw (another mode, scope, size) replaces whatever a Restart drew
  useEffect(() => setRunList(null), [baseCountries]);

  const [priorBest, setPriorBest] = usePriorBest(definition.id, scope, size, mode);
  const { reviewing, setReviewing, result, setResult, fullList, setFullList, savedRunRef, snapshot, restoreResult: restoreReview } = useQuizReview({
    countries, revealedSet, setRevealedSet, setRunList, setPhase
  });
  const target = queue.length ? queue[0] : null;
  /** commitAnswer, defined below: the input handlers call it through this ref. */
  const commitRef = useRef<(note?: string) => void>(() => {});
  const { cancelFill, onInputChange, fillRevealed } = useQuizInput({
    phase, target, revealedSet, definition, lastNote, setInput, setLastNote, commitRef
  });

  /* What the map paints: a review pass keeps the rest of the full run green (settledMarks). */
  const settled = useMemo(
    () => settledMarks(reviewing, fullList, countries, answered),
    [reviewing, fullList, countries, answered]
  );

  /* a different :scope, :size (or quiz) while this route stays mounted is a fresh run, not a
     continuation of the old one; toStart is the same reset, asked for by the panel's Up button */
  /** What toStart and begin both clear. */
  const clearRun = useCallback((review: boolean) => {
    cancelFill();
    setInput('');
    setRevealedSet(new Set());
    setAnswered(new Map());
    setLastNote(null);
    setReviewing(review);
    setResult(null);
    elapsedRef.current = 0;
    shownAtRef.current = new Map();
    skippedRef.current = new Set();
  }, [cancelFill, setReviewing, setResult]);

  const toStart = useCallback(() => {
    clearRun(false);
    setPhase('idle');
    setQueue([]);
    setRunList(null);
    segmentStartRef.current = null;
  }, [clearRun]);
  useEffect(toStart, [definition.id, scope, size, toStart]);

  const begin = useCallback((list: CountryRecord[], review = false) => {
    if (!list.length) return;
    clearRun(review);
    if (!review) setFullList(null);
    const shuffled = shuffle(list, makeRng(Date.now() ^ (Math.random() * 0xffffffff)));
    setQueue(shuffled);
    segmentStartRef.current = Date.now();
    setPhase('running');
    definition.prepare?.(shuffled.slice(0, PREPARE_LOOKAHEAD));
  }, [definition, clearRun, setFullList]);

  const start = useCallback(() => begin(countries), [begin, countries]);
  const restart = useCallback((next?: CountryRecord[]) => {
    if (next) setRunList(next);
    begin(next ?? countries);
  }, [begin, countries]);

  /** Replays the finished run's revealed countries at once, no start screen. */
  const reviewMistakes = useCallback(() => {
    const missed = result?.revealed;
    if (!missed?.length) return;
    // the set to keep painted is the whole run, not a previous review's part of it
    const whole = fullList ?? countries;
    begin(missed, true);
    setRunList(missed);
    setFullList(whole);
  }, [result, begin, fullList, countries, setFullList]);

  /* Back from a dossier: the results, and the map painted the way the run left it. */
  const restoreResult = useCallback((run: FinishedRun) => {
    restoreReview(run);
    setAnswered(new Map(run.countries.map(c => [c.iso3, run.revealedSet.has(c.iso3) ? 'revealed' : 'correct'])));
  }, [restoreReview]);

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

  /* Give up: ends the run where it stands. Whatever is still unanswered counts as missed (red on
     the map, in the results, worth a review); like Abandon nothing is saved — no quizRuns row, no
     FSRS grading, never a personal best. */
  const giveUp = useCallback(() => {
    if (phase !== 'running' && phase !== 'paused') return;
    cancelFill();
    stopSegment();
    const missed = new Set(revealedSet);
    for (const c of queue) missed.add(c.iso3);
    setRevealedSet(missed);
    setAnswered(prev => {
      const next = new Map(prev);
      for (const c of queue) next.set(c.iso3, 'revealed');
      return next;
    });
    setQueue([]);
    setInput('');
    setLastNote(null);
    setPhase('done');
    setResult(scoreRun(countries, missed, priorBest, elapsedRef.current, skippedRef.current.size, true).result);
    savedRunRef.current = Promise.resolve(undefined);
  }, [phase, queue, revealedSet, countries, priorBest, cancelFill, stopSegment, setResult, savedRunRef]);

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

      const { result: scored, firstTryCount, revealedCount, perfect } = scoreRun(
        countries, revealedSet, priorBest, finalElapsedMs, skippedRef.current.size
      );

      setResult(scored);
      if (!reviewing && perfect) setPriorBest(prev => (prev === null ? finalElapsedMs : Math.min(prev, finalElapsedMs)));
      savedRunRef.current = archiveRun(savedRunRef.current, reviewing, {
        quizId: definition.id, scope, size, mode, timeMs: finalElapsedMs,
        totalCount: countries.length, firstTryCount, revealedCount, perfect, at: Date.now()
      });
    },
    [phase, target, definition, revealedSet, review, queue, stopSegment, countries, priorBest, scope, size, mode, reviewing, setResult, savedRunRef]
  );

  commitRef.current = commitAnswer;
  const onInputKeyDown = useCallback(inputKeyDownHandler(skip, reveal, fillRevealed), [skip, reveal, fillRevealed]);

  useQuizKeyboard({ phase, start, togglePause, abandon, skip, reveal, fillRevealed, inputRef, queue, revealedSet });

  const toggleShowNeighbours = useCallback(() => setShowNeighbours(v => !v), []);

  return {
    phase,
    target,
    input,
    revealedSet,
    answered,
    settled,
    answeredCount: answered.size,
    totalCount: countries.length,
    remainingCount: queue.length,
    elapsedMs,
    showNeighbours,
    toggleShowNeighbours,
    lastNote,
    result,
    reviewing,
    priorBest,
    start,
    reviewMistakes,
    snapshot,
    restoreResult,
    restart,
    skip,
    reveal,
    togglePause,
    abandon,
    giveUp,
    toStart,
    onInputChange,
    onInputKeyDown,
    inputRef
  };
}
