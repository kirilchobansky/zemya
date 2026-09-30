/**
 * The subject layer above the quiz catalogue: geography's three quizzes today, history with
 * none yet. A subject is deliberately thin — id, name, blurb and its quizzes — because the
 * quiz engine, scoring and QuizDefinition shape (app/lib/quiz/types.ts) are unchanged by this;
 * a subject only decides which quizzes routes/quizzes.$subject.tsx lists. See CLAUDE.md's
 * Quizzes section and docs/quizzes.md.
 */
import { QUIZ_DEFINITIONS } from '~/lib/geography/quizzes';
import type { QuizDefinition } from './types';

export interface Subject {
  id: string;
  name: string;
  /** A single emoji, same convention as the empty-state icons elsewhere (⌨, 🌍, 🕓) —
   *  no icon font or SVG set for something shown this small and this rarely. */
  icon: string;
  blurb: string;
  quizzes: QuizDefinition[];
  /** The subject's quizzes are "fill the list" quizzes (app/lib/history/fill-quiz.ts), not
   *  QuizDefinitions — generated from the timeline by the list route's loader, so `quizzes`
   *  stays empty and routes/quizzes.$subject.tsx lists them from loader data instead. */
  fillQuizzes?: boolean;
}

/** Geography ships three quizzes. History's are the generated "fill the list" quizzes — see
 *  `fillQuizzes` and docs/quizzes.md; a subject with neither is still rendered as "coming
 *  soon" by routes/quizzes.$subject.tsx rather than crashing on an empty list. */
export const SUBJECTS: Subject[] = [
  {
    id: 'geography',
    name: 'Geography',
    icon: '🌍',
    blurb: 'Countries, flags and capitals — timed rounds built from the atlas catalogue.',
    quizzes: QUIZ_DEFINITIONS
  },
  {
    id: 'history',
    name: 'History',
    icon: '🕓',
    blurb: 'Fill the list — name every ruler or government of a period from its dates.',
    quizzes: [],
    fillQuizzes: true
  }
];

export function subjectById(id: string): Subject | undefined {
  return SUBJECTS.find(s => s.id === id);
}

/** A quiz id only resolves within its own subject — /quizzes/history/countries must not
 *  quietly serve the geography quiz of the same id. */
export function quizInSubject(subject: Subject, quizId: string): QuizDefinition | undefined {
  return subject.quizzes.find(q => q.id === quizId);
}
