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
import { formatDuration } from '~/lib/format';
import { makeRng, shuffle } from '~/lib/core/questions';
import { matchesCountry } from '~/lib/geography/names';
import { isQuizSize, QUIZZES, topByPopulation, type QuizSize } from '~/lib/geography/quizzes';
import { loadWorld } from '~/lib/geography/world';
import type { CountryRecord, World } from '~/lib/map/types';

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
    segmentStartRef.current = null;
  }, [size]);

  const start = useCallback(() => {
    if (!countries.length) return;
    const rng = makeRng(Date.now() ^ (Math.random() * 0xffffffff));
    setQueue(shuffle(countries, rng));
    setInput('');
    setRevealedSet(new Set());
    setAccumulatedMs(0);
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
      if (phase !== 'running' || !target) return;
      if (!matchesCountry(value, target.country)) return;

      const outcome: Outcome = revealedSet.has(target.country.iso3) ? 'revealed' : 'correct';
      setQuiz(prev => {
        if (!prev) return prev;
        const answered = new Map(prev.answered);
        answered.set(target.country.iso3, outcome);
        return { ...prev, answered };
      });
      setInput('');

      const remaining = queue.slice(1);
      setQueue(remaining);
      if (remaining.length === 0) {
        stopSegment();
        setPhase('done');
      }
    },
    [phase, target, revealedSet, queue, setQuiz, stopSegment]
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

        {phase === 'done' && (
          <div className="hook">
            <div className="hook__label">Result</div>
            <p>
              Finished in <b>{formatDuration(accumulatedMs)}</b>.
            </p>
            <button type="button" className="action action--primary" onClick={start}>
              Run it again
            </button>
            <p style={{ marginTop: 10 }}>
              <Link to="/quiz" className="action">
                Back to quizzes
              </Link>
            </p>
          </div>
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
