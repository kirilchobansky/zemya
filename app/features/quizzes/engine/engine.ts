/**
 * The quiz engine: owns a run end-to-end — question order, the current target, attempt
 * state, timer accumulation, pause/resume, abandon, per-answer outcome (first-try /
 * skipped-then-got / revealed), completion, the results payload, the personal-best write
 * and FSRS grading.
 *
 * Deliberately ignorant of maps, flag images or anything else a Stage renders — it knows
 * a list of countries and a callback per answer. routes/quizzes/quiz.$quizId.tsx is what wires
 * this to the atlas (camera, quiz-mode map painting); this file must never import from
 * ~/engines/map or any component. See CLAUDE.md's Quizzes section.
 */
import {
  useCallback, useEffect, useRef, useState,
  type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject
} from 'react';

import { useProgress, bestQuizTime, saveQuizRun, makeRng, shuffle } from '~/features/progress';
import type { ReviewRating } from '~/features/progress';
import { cardId, matchesCountry } from '~/features/countries';
import type { CountryRecord } from '~/engines/map/types';
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
  /** Starts a fresh run over an active one — nothing saved, no FSRS grading — on `next`, a newly
   *  drawn set (the route passes it; omitted = reshuffle the current set). */
  restart(next?: CountryRecord[]): void;
  skip(): void;
  reveal(): void;
  togglePause(): void;
  abandon(): void;
  /** Leave a run (or its results) for the start screen, nothing saved — the panel's Up button. */
  toStart(): void;
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

  const [priorBest, setPriorBest] = useState<number | null>(null);
  const [result, setResult] = useState<QuizRunResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    bestQuizTime(definition.id, scope, size).then(best => { if (!cancelled) setPriorBest(best); });
    return () => { cancelled = true; };
  }, [definition.id, scope, size]);

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
      } else if (e.key === 'Enter') {
        // A phone's "done" key would otherwise dismiss the keyboard; it fills in a revealed
        // answer, and otherwise has no meaning — answers are accepted the instant they match.
        e.preventDefault();
        fillRevealed();
      }
    },
    [skip, reveal, fillRevealed]
  );

  /* Initial focus, and belt-and-braces refocus after a phase change. NOT what keeps typing
     working — a canvas click blurs the input without changing phase, so this alone left the
     rest of the run dead to the keyboard. The document-level capture below is the guarantee. */
  useEffect(() => {
    if (phase === 'running' || phase === 'paused') inputRef.current?.focus();
  }, [phase, queue, revealedSet]);

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
