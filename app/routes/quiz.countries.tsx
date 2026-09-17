/**
 * "Name the Country": the map flies to a country, highlighted in brass; type its name to
 * advance. See CLAUDE.md's Quizzes section for the full spec this implements — camera
 * framing lives in camera.ts's frameForQuiz, answer matching in geography/names.ts,
 * per-country colouring in geography/overlays.ts's quizFillFor/quizStrokeFor, and the
 * "no leaked answers" rules (labels, tooltip, search, neighbour glow) in the shared
 * `quiz` override this file writes through useAtlasContext() — see atlas.tsx.
 *
 * Renders two things from one component: the right panel (this component's return value,
 * same as every other panel route) and a text input docked over the map itself via fixed
 * positioning (`.quiz-dock`, centred using the same --rail-width/--panel-width tokens the
 * rest of the layout is built from) — the input has to sit on the map, not in the panel,
 * per the interaction spec, even though both come from this one route.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router';

import { useAtlasContext } from './atlas';
import { useProgress } from '~/lib/core/ProgressProvider';
import { bestQuizTime, saveQuizRun } from '~/lib/core/progress';
import { makeRng, shuffle } from '~/lib/core/questions';
import type { ReviewRating } from '~/lib/core/scheduler';
import { formatDuration } from '~/lib/format';
import { cardId } from '~/lib/geography/mastery';
import { matchesCountry } from '~/lib/geography/names';
import { isQuizSize, QUIZZES, topByPopulation, type QuizSize } from '~/lib/geography/quizzes';
import { loadWorld } from '~/lib/geography/world';
import type { CountryRecord, World } from '~/lib/map/types';

/** Grading thresholds mapped onto FSRS's four ratings — see CLAUDE.md's Quizzes section. */
const EASY_MS = 5000;

const DEFAULT_SIZE: QuizSize = '20';

export function meta() {
  return [
    { title: 'Name the Country — Zemya' },
    { name: 'description', content: 'A timed run: the map flies to a country, type its name to advance.' }
  ];
}

type Phase = 'idle' | 'running' | 'paused' | 'done';
type Outcome = 'correct' | 'revealed';

export default function QuizCountriesRun() {
  const params = useParams<{ size: string }>();
  const size: QuizSize = params.size && isQuizSize(params.size) ? params.size : DEFAULT_SIZE;
  const quizTitle = QUIZZES.find(q => q.id === 'countries')?.title ?? 'Name the Country';

  const { atlas, quiz, setQuiz } = useAtlasContext();
  const { review } = useProgress();

  const [world, setWorld] = useState<World | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadWorld().then(w => { if (!cancelled) setWorld(w); });
    return () => { cancelled = true; };
  }, []);

  const countries = useMemo(
    () => (world ? topByPopulation(world.data.countries, size) : []),
    [world, size]
  );

  const [phase, setPhase] = useState<Phase>('idle');
  const [queue, setQueue] = useState<CountryRecord[]>([]);
  const [input, setInput] = useState('');
  const [revealedSet, setRevealedSet] = useState<ReadonlySet<string>>(new Set());
  const [accumulatedMs, setAccumulatedMs] = useState(0);
  const [tick, setTick] = useState(0); // forces a re-render so the live timer moves
  const segmentStartRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** When each country most recently became the target, and which countries were ever
   *  skipped — read once per answer to grade the location card (see handleInputChange)
   *  and never rendered, so refs rather than state. */
  const shownAtRef = useRef<Map<string, number>>(new Map());
  const skippedRef = useRef<Set<string>>(new Set());

  const [priorBest, setPriorBest] = useState<number | null>(null);
  interface RunResult {
    timeMs: number;
    firstTryCount: number;
    revealed: CountryRecord[];
    beatBest: boolean;
    /** The best time going INTO this run, snapshotted at finish time — priorBest itself
     *  gets folded forward to include this run's own time right after, so the display
     *  must read this copy rather than the reactive state or "beat your best" would
     *  compare the new time against itself once the state settles. */
    previousBest: number | null;
  }
  const [result, setResult] = useState<RunResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    bestQuizTime('countries', size).then(best => { if (!cancelled) setPriorBest(best); });
    return () => { cancelled = true; };
  }, [size]);

  const target = useMemo(() => {
    if (!world || queue.length === 0) return null;
    return world.byIso3.get(queue[0].iso3) ?? null;
  }, [world, queue]);

  /* quiz mode covers the whole lifetime of this route, not just the running phase — the
     map should already be in its stripped-down, full-screen state on the START (idle)
     screen. Torn down on unmount so leaving /quiz/countries restores the normal map. */
  useEffect(() => {
    setQuiz({ target: null, answered: new Map(), showNeighbours: false, paused: false });
    return () => setQuiz(null);
  }, [setQuiz]);

  /* a different :size while this route stays mounted (e.g. a Link between two sizes) is
     a fresh run, not a continuation of the old one */
  useEffect(() => {
    setPhase('idle');
    setQueue([]);
    setInput('');
    setRevealedSet(new Set());
    setAccumulatedMs(0);
    setResult(null);
    segmentStartRef.current = null;
    shownAtRef.current = new Map();
    skippedRef.current = new Set();
  }, [size]);

  const start = useCallback(() => {
    if (!countries.length) return;
    const rng = makeRng(Date.now() ^ (Math.random() * 0xffffffff));
    setQueue(shuffle(countries, rng));
    setInput('');
    setRevealedSet(new Set());
    setAccumulatedMs(0);
    setResult(null);
    shownAtRef.current = new Map();
    skippedRef.current = new Set();
    segmentStartRef.current = Date.now();
    setPhase('running');
  }, [countries]);

  /* Space or Enter also starts a run — the input doesn't exist yet to carry a keydown
     handler, so this is the one shortcut that has to live on the window. */
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

  /* fly to the current target whenever it changes — covers the first question on START
     and every answer/skip after it, since both always change queue[0] */
  useEffect(() => {
    if (phase !== 'running' || !atlas || !target) return;
    atlas.flyToQuiz(target);
    setQuiz(prev => (prev ? { ...prev, target } : prev));
    shownAtRef.current.set(target.country.iso3, Date.now());
  }, [phase, target, atlas, setQuiz]);

  /* live timer tick while running; frozen (not just visually — accumulatedMs itself stops
     growing) the instant the run is paused or finishes */
  useEffect(() => {
    if (phase !== 'running') return;
    const id = window.setInterval(() => setTick(t => t + 1), 200);
    return () => window.clearInterval(id);
  }, [phase]);
  void tick;

  const liveElapsedMs =
    accumulatedMs + (phase === 'running' && segmentStartRef.current ? Date.now() - segmentStartRef.current : 0);

  const stopSegment = useCallback(() => {
    setAccumulatedMs(a => a + (segmentStartRef.current ? Date.now() - segmentStartRef.current : 0));
    segmentStartRef.current = null;
  }, []);

  const skip = useCallback(() => {
    if (phase !== 'running' || queue.length < 2) return;
    skippedRef.current.add(queue[0].iso3);
    setQueue(q => [...q.slice(1), q[0]]);
    setInput('');
  }, [phase, queue]);

  const reveal = useCallback(() => {
    if (phase !== 'running' || !target) return;
    setRevealedSet(s => (s.has(target.country.iso3) ? s : new Set(s).add(target.country.iso3)));
  }, [phase, target]);

  const togglePause = useCallback(() => {
    if (phase === 'running') {
      stopSegment();
      setPhase('paused');
      setQuiz(prev => (prev ? { ...prev, paused: true } : prev));
    } else if (phase === 'paused') {
      segmentStartRef.current = Date.now();
      setPhase('running');
      setQuiz(prev => (prev ? { ...prev, paused: false } : prev));
    }
  }, [phase, stopSegment, setQuiz]);

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInput(value);
      if (phase !== 'running' || !target || !world) return;
      if (!matchesCountry(value, target.country)) return;

      const iso3 = target.country.iso3;
      const wasRevealed = revealedSet.has(iso3);
      const wasSkipped = skippedRef.current.has(iso3);
      const elapsedMs = Date.now() - (shownAtRef.current.get(iso3) ?? Date.now());

      /* Feed the spaced repetition: this is the point of having built FSRS. Playing the
         quiz schedules the countries you don't know for review in study mode — location
         is graded here even though study mode still can't ask it (ASKABLE_FACETS
         excludes it); the quiz IS the location question. See CLAUDE.md's Quizzes section. */
      const rating: ReviewRating = wasRevealed ? 'again' : wasSkipped ? 'hard' : elapsedMs < EASY_MS ? 'easy' : 'good';
      review(cardId(iso3, 'location'), rating);

      const outcome: Outcome = wasRevealed ? 'revealed' : 'correct';
      setQuiz(prev => {
        if (!prev) return prev;
        const answered = new Map(prev.answered);
        answered.set(iso3, outcome);
        return { ...prev, answered };
      });
      setInput('');

      const remaining = queue.slice(1);
      setQueue(remaining);
      if (remaining.length === 0) {
        const finalElapsedMs = accumulatedMs + (segmentStartRef.current ? Date.now() - segmentStartRef.current : 0);
        stopSegment();
        setPhase('done');
        atlas?.home();

        const revealed = [...revealedSet]
          .map(revealedIso3 => world.byIso3.get(revealedIso3)?.country)
          .filter((c): c is CountryRecord => Boolean(c));
        const firstTryCount = countries.length - revealed.length;
        const beatBest = priorBest === null || finalElapsedMs < priorBest;

        setResult({ timeMs: finalElapsedMs, firstTryCount, revealed, beatBest, previousBest: priorBest });
        setPriorBest(prev => (prev === null ? finalElapsedMs : Math.min(prev, finalElapsedMs)));
        saveQuizRun({
          quizId: 'countries',
          size,
          timeMs: finalElapsedMs,
          totalCount: countries.length,
          firstTryCount,
          revealedCount: revealed.length,
          at: Date.now()
        });
      }
    },
    [phase, target, world, revealedSet, review, queue, setQuiz, accumulatedMs, stopSegment, atlas, countries, priorBest, size]
  );

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Tab') {
      e.preventDefault();
      skip();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      reveal();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      togglePause();
    }
  }

  /* the input must never need the mouse to regain focus — refocus after every state
     change that could plausibly have moved it (a new question, a reveal, resuming) */
  useEffect(() => {
    if (phase === 'running') inputRef.current?.focus();
  }, [phase, queue, revealedSet]);

  /**
   * Test seam, mirroring ProgressProvider's `window.__zemya` — a separate global so it
   * never clobbers that one, since both are mounted at once here. `import.meta.env.DEV`
   * makes this dead code in a production build. test/smoke.mjs reads the current target's
   * name from here rather than guessing it from pixels, then asserts the NEXT target's
   * name appears nowhere in the page — the regression test for the map leaking an answer.
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __zemyaQuiz?: unknown }).__zemyaQuiz = {
      target: target?.country.name ?? null,
      answeredCount: quiz?.answered.size ?? 0,
      phase
    };
  }, [target, quiz, phase]);

  if (!world) {
    return (
      <>
        <header className="panel__head">
          <span className="panel__eyebrow">{quizTitle}</span>
          <h2>Preparing…</h2>
        </header>
        <div className="panel__body">
          <div className="empty">
            <div className="empty__icon">🌍</div>
            <p>Loading the map.</p>
          </div>
        </div>
      </>
    );
  }

  const answeredCount = quiz?.answered.size ?? 0;

  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">{quizTitle}</span>
        <h2>{countries.length} countries</h2>
      </header>

      <div className="panel__body">
        {phase === 'idle' && (
          <div className="empty">
            <div className="empty__icon">⌨</div>
            <p>Press START on the map — or Space, or Enter — to begin. Nothing is timed until you do.</p>
          </div>
        )}

        {(phase === 'running' || phase === 'paused') && (
          <>
            <div className="quiz-run__timer numeric">{formatDuration(liveElapsedMs)}</div>
            <div className="quiz-run__count numeric">
              {answeredCount} / {countries.length}
            </div>

            <div className="actions">
              <button type="button" className="action" onClick={skip} disabled={queue.length < 2}>
                Skip <kbd>Tab</kbd>
              </button>
              <button
                type="button"
                className="action"
                onClick={reveal}
                disabled={!target || revealedSet.has(target.country.iso3)}
              >
                Reveal <kbd>Ctrl+Enter</kbd>
              </button>
              <button type="button" className="action" onClick={togglePause}>
                {phase === 'paused' ? 'Resume' : 'Pause'} <kbd>Esc</kbd>
              </button>
            </div>

            <button
              type="button"
              className="tool"
              style={{ alignSelf: 'flex-start' }}
              aria-pressed={quiz?.showNeighbours ?? false}
              onClick={() => setQuiz(prev => (prev ? { ...prev, showNeighbours: !prev.showNeighbours } : prev))}
            >
              Neighbour glow
            </button>

            {phase === 'paused' && (
              <div className="note">Paused — the timer is stopped. Press Esc or Resume to continue.</div>
            )}
          </>
        )}

        {phase === 'done' && result && (
          <>
            <div className="hook">
              <div className="hook__label">Result</div>
              <p className="quiz-result__time numeric">{formatDuration(result.timeMs)}</p>
              <p style={{ marginBottom: 6 }}>
                {result.beatBest ? (
                  result.previousBest !== null ? (
                    <>New personal best — beat <b>{formatDuration(result.previousBest)}</b>.</>
                  ) : (
                    <>First run at this size — <b>{formatDuration(result.timeMs)}</b> is now your personal best.</>
                  )
                ) : (
                  <>Personal best stays <b>{formatDuration(result.previousBest ?? result.timeMs)}</b>.</>
                )}
              </p>
              <p>
                <b>{result.firstTryCount}</b> first-try, <b>{result.revealed.length}</b> revealed
                {' '}(of {countries.length}).
              </p>
            </div>

            {result.revealed.length > 0 && (
              <section>
                <h3 className="subhead">Revealed — the ones worth another look</h3>
                <div className="neighbours">
                  {result.revealed.map(country => (
                    <Link className="neighbour" key={country.iso3} to={`/country/${country.slug}`}>
                      {country.emoji} {country.name}
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <div className="actions">
              <button type="button" className="action action--primary" onClick={start}>
                Run it again
              </button>
              <Link to="/quiz" className="action">
                Back to quizzes
              </Link>
            </div>
          </>
        )}
      </div>

      {phase !== 'done' && (
        <div className="quiz-dock">
          {phase === 'idle' && (
            <button type="button" className="quiz-dock__start" onClick={start}>
              START
            </button>
          )}
          {(phase === 'running' || phase === 'paused') && (
            <>
              {target && revealedSet.has(target.country.iso3) && (
                <div className="quiz-dock__answer">{target.country.name}</div>
              )}
              <input
                ref={inputRef}
                className="quiz-dock__input"
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={phase === 'paused'}
                value={input}
                onChange={handleInputChange}
                onKeyDown={onInputKeyDown}
                placeholder="Type the country's name…"
                aria-label="Type the country's name"
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
