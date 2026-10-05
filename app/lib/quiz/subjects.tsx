/**
 * The subject layer above the quiz catalogue: geography's quizzes, history with
 * none yet. A subject is deliberately thin — id, name, blurb and its quizzes — because the
 * quiz engine, scoring and QuizDefinition shape (app/lib/quiz/types.ts) are unchanged by this;
 * a subject only decides which quizzes routes/quizzes.$subject.tsx lists. See CLAUDE.md's
 * Quizzes section and docs/quizzes.md.
 */
import { NAME_ALL_QUIZ, QUIZ_DEFINITIONS } from '~/lib/geography/quizzes';
import type { QuizDefinition } from './types';

export interface Subject {
  id: string;
  name: string;
  /** A single emoji, same convention as the empty-state icons elsewhere (⌨, 🌍, 🕓) —
   *  no icon font or SVG set for something shown this small and this rarely. */
  icon: string;
  blurb: string;
  quizzes: QuizDefinition[];
  /** Listed after `quizzes` but not run by the engine (geography's "Name all countries"). */
  extraQuizzes?: readonly Pick<QuizDefinition, 'id' | 'title' | 'description'>[];
  /** The subject's quizzes are "fill the list" quizzes (app/lib/history/fill-quiz.ts), not
   *  QuizDefinitions — listed per country from fill-quiz-config.ts by the list route's loader,
   *  so `quizzes` stays empty and routes/quizzes.$subject.tsx shows a country list instead. */
  fillQuizzes?: boolean;
}

/** Geography's quizzes are QUIZ_DEFINITIONS plus `extraQuizzes`. History's are the "fill the list" quizzes — see
 *  `fillQuizzes` and docs/quizzes.md. */
export const SUBJECTS: Subject[] = [
  {
    id: 'geography',
    name: 'Geography',
    icon: '🌍',
    blurb: 'Countries, flags, outlines, capitals, currencies, languages and religions — timed rounds built from the atlas catalogue.',
    quizzes: QUIZ_DEFINITIONS,
    extraQuizzes: [NAME_ALL_QUIZ]
  },
  {
    id: 'history',
    name: 'History',
    icon: '🕓',
    blurb: 'Fill the list — name every ruler, president or prime minister from their dates.',
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

/** Every quiz a subject lists — what its card on /quizzes counts. */
export function quizCount(subject: Subject): number {
  return subject.quizzes.length + (subject.extraQuizzes?.length ?? 0);
}
