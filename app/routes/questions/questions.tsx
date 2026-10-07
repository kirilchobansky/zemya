/**
 * The Questions route: renders inside the atlas layout's right-hand panel, exactly like the
 * dossier. The panel and its logic live in features/questions. /study permanently redirects
 * here (routes/questions/study.tsx).
 */
import { QuestionsPanel } from '~/features/questions';
import { pageMeta } from '~/shared/lib/seo';

export function meta() {
  return pageMeta({
    title: 'Questions — Zemya',
    description: 'A spaced-repetition quiz session over what you have and have not learned yet.',
    path: '/questions'
  });
}

export default function QuestionsRoute() {
  return <QuestionsPanel />;
}
