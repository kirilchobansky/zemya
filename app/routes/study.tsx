/**
 * The study panel: a session of multiple-choice questions drawn from FSRS-due and new
 * cards. Renders inside the atlas layout's right-hand panel, exactly like the dossier —
 * the map stays mounted underneath and, per the camera rule in CLAUDE.md, /study never
 * moves it: naming a country in a question is not the user asking to see it.
 *
 * SSR guard: no indexedDB or fetch at module scope. Cards come from useProgress() (already
 * effect-gated) and the country catalogue loads in its own effect below — prerender yields
 * the "preparing" shell with nothing built yet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';

import { Flag } from '~/components/Flag';
import { useProgress } from '~/lib/core/ProgressProvider';
import { makeRng, type Question } from '~/lib/core/questions';
import { pageMeta } from '~/lib/seo';
import { buildCatalogue, generateSession, type Catalogue } from '~/lib/geography/questions';
import { parseCardId } from '~/lib/geography/mastery';
import { loadWorld } from '~/lib/geography/world';

const SESSION_SIZE = 12;
/** Grading thresholds for a binary right/wrong quiz screen, mapped onto FSRS's four
 *  grades — see the scheduler.ts docs for why all four exist even though this is the only
 *  screen driving them so far. */
const EASY_MS = 6000;

export function meta() {
  return pageMeta({
    title: 'Study — Zemya',
    description: 'A spaced-repetition quiz session over what you have and have not learned yet.',
    path: '/study'
  });
}

interface Answer {
  chosenIndex: number;
  correct: boolean;
}

interface Round {
  question: Question;
  answer: Answer;
}

export default function StudyPanel() {
  const { cards, ready, review } = useProgress();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [session, setSession] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [hintUsed, setHintUsed] = useState(false);
  const [eliminated, setEliminated] = useState<number | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const answeredAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    loadWorld().then(world => {
      if (!cancelled) setCatalogue(buildCatalogue(world.data.countries));
    });
    return () => { cancelled = true; };
  }, []);

  const startSession = useCallback(() => {
    if (!catalogue) return;
    const rng = makeRng(Date.now() ^ (Math.random() * 0xffffffff));
    setSession(generateSession(catalogue.countries, cards, catalogue, rng, Date.now(), SESSION_SIZE));
    setIndex(0);
    setAnswer(null);
    setHintUsed(false);
    setEliminated(null);
    setRounds([]);
    answeredAt.current = Date.now();
    // cards is intentionally read once, at the moment the session is built — not a
    // reactive dependency, or grading mid-session would reshuffle what's still to come
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue]);

  useEffect(() => {
    if (catalogue && ready && session === null) startSession();
  }, [catalogue, ready, session, startSession]);

  const question = session && index < session.length ? session[index] : null;

  const promptCountry = useMemo(() => {
    if (!question || !catalogue) return null;
    const parsed = parseCardId(question.cardId);
    return parsed ? catalogue.byIso3.get(parsed.iso3) ?? null : null;
  }, [question, catalogue]);

  const choose = useCallback(
    (chosenIndex: number) => {
      if (!question || answer) return;
      const correct = chosenIndex === question.answerIndex;
      const elapsed = Date.now() - answeredAt.current;
      const rating = !correct ? 'again' : hintUsed ? 'hard' : elapsed < EASY_MS ? 'easy' : 'good';
      review(question.cardId, rating);
      const result: Answer = { chosenIndex, correct };
      setAnswer(result);
      setRounds(r => [...r, { question, answer: result }]);
    },
    [question, answer, hintUsed, review]
  );

  const useHint = useCallback(() => {
    if (!question || answer || hintUsed) return;
    const wrongIndices = question.options
      .map((_, i) => i)
      .filter(i => i !== question.answerIndex);
    setEliminated(wrongIndices[Math.floor(Math.random() * wrongIndices.length)]);
    setHintUsed(true);
  }, [question, answer, hintUsed]);

  const next = useCallback(() => {
    setAnswer(null);
    setHintUsed(false);
    setEliminated(null);
    answeredAt.current = Date.now();
    setIndex(i => i + 1);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!question || answer) return;
      const n = Number(event.key);
      if (n >= 1 && n <= question.options.length) choose(n - 1);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [question, answer, choose]);

  if (!session) {
    return (
      <>
        <header className="panel__head">
          <span className="panel__eyebrow">Study</span>
          <h2>Preparing…</h2>
        </header>
        <div className="panel__body">
          <div className="empty">
            <div className="empty__icon">🎓</div>
            <p>Loading your next session.</p>
          </div>
        </div>
      </>
    );
  }

  if (session.length === 0) {
    return (
      <>
        <header className="panel__head">
          <span className="panel__eyebrow">Study</span>
          <h2>Nothing to study</h2>
        </header>
        <div className="panel__body">
          <div className="empty">
            <div className="empty__icon">🎓</div>
            <p>No cards are due yet. Explore the map to meet new countries.</p>
          </div>
        </div>
      </>
    );
  }

  if (!question) {
    const right = rounds.filter(r => r.answer.correct).length;
    const missed = rounds.filter(r => !r.answer.correct);
    return (
      <>
        <header className="panel__head">
          <span className="panel__eyebrow">Study</span>
          <h2>Session complete</h2>
        </header>
        <div className="panel__body">
          <div className="hook">
            <div className="hook__label">Result</div>
            <p>
              {right} / {session.length} correct
            </p>
          </div>

          {missed.length > 0 && (
            <section>
              <h3 className="subhead">Missed</h3>
              <div className="neighbours">
                {missed.map(({ question: q }) => {
                  const parsed = parseCardId(q.cardId);
                  const country = parsed ? catalogue?.byIso3.get(parsed.iso3) : null;
                  if (!country) return null;
                  return (
                    <Link className="neighbour" key={q.id} to={`/country/${country.slug}`}>
                      {country.emoji} {country.name}
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <button type="button" className="action action--primary" onClick={startSession}>
            Study again
          </button>
        </div>
      </>
    );
  }

  const pct = Math.round((index / session.length) * 100);

  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">Study</span>
        <h2>
          {index + 1} / {session.length}
        </h2>
      </header>

      <div className="panel__body">
        <div className="quiz__bar">
          <div className="quiz__bar-fill" style={{ width: `${pct}%` }} />
        </div>

        {question.promptFlag ? (
          <div className="quiz__prompt-flag">
            <Flag
              iso2={question.promptFlag}
              emoji={promptCountry?.emoji ?? ''}
              flagRatio={promptCountry?.flagRatio ?? 4 / 3}
              size="lg"
            />
          </div>
        ) : (
          <p className="quiz__prompt">{question.prompt}</p>
        )}

        <div className="quiz__options">
          {question.options.map((option, i) => {
            const state = answer
              ? i === question.answerIndex
                ? 'correct'
                : i === answer.chosenIndex
                  ? 'wrong'
                  : undefined
              : i === eliminated
                ? 'eliminated'
                : undefined;
            return (
              <button
                key={option}
                type="button"
                className="quiz__option"
                data-state={state}
                disabled={Boolean(answer) || i === eliminated}
                onClick={() => choose(i)}
              >
                <span className="quiz__option-key">{i + 1}</span>
                {option}
              </button>
            );
          })}
        </div>

        {!answer && (
          <button type="button" className="action" disabled={hintUsed} onClick={useHint}>
            Hint
          </button>
        )}

        {answer && (
          <>
            <div className="hook">
              <div className="hook__label">Memory hook</div>
              {/* Hooks are authored as fragments with an implied subject (see
                  CLAUDE.md's Content conventions) — right under the dossier's own
                  heading that's fine, but here the question could have been about any
                  country, so the subject has to be supplied. */}
              <p>
                <b>{promptCountry?.name}</b> — {question.hook}
              </p>
            </div>
            <button type="button" className="action action--primary" onClick={next}>
              Next
            </button>
          </>
        )}
      </div>
    </>
  );
}
