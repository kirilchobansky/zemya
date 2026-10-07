/**
 * The Questions panel (the route is routes/questions/questions.tsx): a session of multiple-choice questions drawn from FSRS-due and new
 * cards. Renders inside the atlas layout's right-hand panel, exactly like the dossier —
 * the map stays mounted underneath and, per the camera rule in CLAUDE.md, /questions never
 * moves it: naming a country in a question is not the user asking to see it.
 *
 * Formerly "Study" — renamed for a more advanced system later, but the engine, content
 * and FSRS review-store keys (~/features/progress) are unchanged, so no progress is lost or
 * reinterpreted by the rename. /study permanently redirects here (routes/questions/study.tsx).
 */
import { QuestionCard } from './QuestionCard';
import { QuestionsMessage } from './QuestionsMessage';
import { QuestionsResult } from './QuestionsResult';
import { useQuestionSession } from './use-question-session';
import './questions.css';

export function QuestionsPanel() {
  const {
    catalogue, session, index, question, answer, hintUsed, eliminated, rounds, promptCountry,
    startSession, choose, useHint, next
  } = useQuestionSession();

  if (!session) return <QuestionsMessage title="Preparing…" text="Loading your next session." />;

  if (session.length === 0) {
    return <QuestionsMessage title="Nothing to review" text="No cards are due yet. Explore the map to meet new countries." />;
  }

  if (!question) {
    return <QuestionsResult rounds={rounds} total={session.length} catalogue={catalogue} onAgain={startSession} />;
  }

  return (
    <QuestionCard
      question={question} index={index} total={session.length} answer={answer} eliminated={eliminated}
      hintUsed={hintUsed} promptCountry={promptCountry}
      onChoose={choose} onHint={useHint} onNext={next}
    />
  );
}
