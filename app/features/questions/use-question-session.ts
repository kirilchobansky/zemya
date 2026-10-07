/**
 * State and logic of one Questions session: loads the catalogue, builds a session of FSRS-due
 * and new cards, grades each answer, hints, and moves on. No JSX; the screens are
 * QuestionsPanel.tsx and its parts.
 *
 * SSR guard: no indexedDB or fetch at module scope. Cards come from useProgress() (already
 * effect-gated) and the country catalogue loads in its own effect — prerender yields the
 * "preparing" shell with nothing built yet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useProgress, makeRng, type Question } from '~/features/progress';
import { buildCatalogue, generateSession, type Catalogue, parseCardId, loadWorld } from '~/features/countries';

const SESSION_SIZE = 12;
/** Grading thresholds for a binary right/wrong quiz screen, mapped onto FSRS's four
 *  grades — see the scheduler.ts docs for why all four exist even though this is the only
 *  screen driving them so far. */
const EASY_MS = 6000;

export interface Answer {
  chosenIndex: number;
  correct: boolean;
}

export interface Round {
  question: Question;
  answer: Answer;
}

export function useQuestionSession() {
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

  return {
    catalogue, session, index, question, answer, hintUsed, eliminated, rounds, promptCountry,
    startSession, choose, useHint, next
  };
}
