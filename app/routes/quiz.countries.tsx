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
import { Link, useNavigate, useParams } from 'react-router';

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
  const navigate = useNavigate();
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
  // A ref, not state: the timer's own math must never depend on when a setState happens
  // to be applied/batched — a plain ref mutation is immediate and synchronous, so
  // "continue from where it was" on resume can't be skewed by render timing.
  const elapsedRef = useRef(0);
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

  /* Read only in the unmount cleanup below — kept as a ref, not a dependency, so that
     effect runs once on mount/unmount and never mid-run just because the Atlas controller
     finished initialising after this route did (see its own comment). */
  const atlasRef = useRef(atlas);
  atlasRef.current = atlas;

  /* quiz mode covers the whole lifetime of this route, not just the running phase — the
     map should already be in its stripped-down, full-screen state on the START (idle)
     screen. Torn down on unmount so leaving /quiz/countries restores the normal map.
     Deliberately depends on nothing but the (stable) setQuiz setter: if this also
     depended on `atlas`, it would re-fire — and wipe the in-progress answered map — the
     moment the Atlas controller finished initialising after this route had already
     mounted and the user had started answering. */
  useEffect(() => {
    setQuiz({ target: null, answered: new Map(), showNeighbours: false, paused: false });
    return () => {
      setQuiz(null);
      atlasRef.current?.setFocus([]); // don't leave a random country's pin permanently enlarged
    };
  }, [setQuiz]);

  /* a different :size while this route stays mounted (e.g. a Link between two sizes) is
     a fresh run, not a continuation of the old one */
  useEffect(() => {
    setPhase('idle');
    setQueue([]);
    setInput('');
    setRevealedSet(new Set());
    elapsedRef.current = 0;
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
    elapsedRef.current = 0;
    setResult(null);
    shownAtRef.current = new Map();
    skippedRef.current = new Set();
    segmentStartRef.current = Date.now();
    setPhase('running');
    // little to no zoom, on purpose — the run stays at (roughly) the world view the whole
    // time, so a country is found by its highlight, not by the camera flying to it; see
    // CLAUDE.md's Quizzes section
    atlas?.home();
  }, [countries, atlas]);

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

  /* The camera itself never moves per question — only the target's pin/shape is marked
     "in focus" (renderer.ts draws a bigger, ringed pin for it — see quizMode's own note
     there), which is what makes a small country findable at world zoom without flying
     the map to it. */
  useEffect(() => {
    if (phase !== 'running' || !atlas) return;
    atlas.setFocus(target ? [target] : []);
    setQuiz(prev => (prev ? { ...prev, target } : prev));
    if (target) shownAtRef.current.set(target.country.iso3, Date.now());
  }, [phase, target, atlas, setQuiz]);

  /* live timer tick while running; frozen (not just visually — elapsedRef itself stops
     growing) the instant the run is paused or finishes */
  useEffect(() => {
    if (phase !== 'running') return;
    const id = window.setInterval(() => setTick(t => t + 1), 200);
    return () => window.clearInterval(id);
  }, [phase]);
  void tick;

  const liveElapsedMs =
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

  /* Abandon: quit the run outright, nothing saved — no quizRuns row, no FSRS grading for
     whatever was answered so far. Just navigate away; the route unmounts, which is what
     already tears the quiz override down and restores the normal map (see the mount
     effect above). Nothing here needs to reset local state first. */
  const abandon = useCallback(() => {
    navigate('/quiz');
  }, [navigate]);

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

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      // ignored, not disabled, while paused — an actually-disabled <input> can't hold
      // keyboard focus at all, which is what made Esc-to-resume unreachable (see the
      // paused-Escape effect above)
      if (phase !== 'running' || !target || !world) return;
      const value = e.target.value;
      setInput(value);
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
        // computed from the refs directly, not the render-scope liveElapsedMs — refs are
        // always current, but this callback's closure could otherwise be stale
        const finalElapsedMs =
          elapsedRef.current + (segmentStartRef.current ? Date.now() - segmentStartRef.current : 0);
        stopSegment();
        setPhase('done');
        atlas?.home();
        atlas?.setFocus([]);

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
    [phase, target, world, revealedSet, review, queue, setQuiz, stopSegment, atlas, countries, priorBest, size]
  );

  /* Escape is deliberately not handled here — it's a window-level listener above, so
     pausing can never leave itself with no focused, enabled element to resume from. */
  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Tab') {
      e.preventDefault();
      skip();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      reveal();
    }
  }

  /* the input must never need the mouse to regain focus — refocus after every state
     change that could plausibly have moved it (a new question, a reveal, pausing,
     resuming). Kept focused while paused too — Esc is a window-level listener now (see
     above), but there's no reason to drop focus just because typing is ignored. */
  useEffect(() => {
    if (phase === 'running' || phase === 'paused') inputRef.current?.focus();
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
      phase,
      elapsedMs: liveElapsedMs
    };
  }, [target, quiz, phase, liveElapsedMs]);

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
              <button type="button" className="action" onClick={abandon}>
                Abandon <kbd>Ctrl+⌫</kbd>
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
                // NOT the `disabled` attribute while paused — a disabled element can't
                // hold keyboard focus, which is exactly what broke Esc-to-resume. Paused
                // input is ignored in handleInputChange instead; this is purely visual.
                className={`quiz-dock__input${phase === 'paused' ? ' quiz-dock__input--paused' : ''}`}
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={input}
                onChange={handleInputChange}
                onKeyDown={onInputKeyDown}
                placeholder={phase === 'paused' ? 'Paused' : "Type the country's name…"}
                aria-label="Type the country's name"
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
