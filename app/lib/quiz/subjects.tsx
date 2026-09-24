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
}

/** Geography ships three quizzes; history is a placeholder with none — see CLAUDE.md's Do
 *  Not section for why a full history subject isn't being built yet. This is UI scaffolding
 *  for the picker, not a start on history content. routes/quizzes.$subject.tsx renders an
 *  empty subject as "coming soon" rather than crashing on an empty list. */
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
    blurb: 'Coming soon.',
    quizzes: []
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
