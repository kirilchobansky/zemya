import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

/**
 * The atlas layout owns the map canvas. Both child routes render only the right-hand
 * panel, so navigating between countries never unmounts or re-initialises the renderer —
 * the URL is the selection, and the camera just flies.
 */
export default [
  layout('routes/atlas.tsx', [
    index('routes/atlas.index.tsx'),
    route('country/:slug', 'routes/country.tsx'),

    // Questions (formerly Study) — same FSRS engine and store keys, new name only.
    route('questions', 'routes/questions.tsx'),
    // permanent redirect from the old name
    route('study', 'routes/study.tsx'),

    // subject -> quiz list -> run. See docs/quizzes.md's "Route shape".
    route('quizzes', 'routes/quizzes.tsx'),
    route('quizzes/:subject', 'routes/quizzes.$subject.tsx'),
    // History is subject -> country -> quiz. /quizzes/history (the country list) is the plain
    // :subject route; the next two levels are second route ids on the same files, because one
    // file can't be two routes under one id. A country's quizzes (:slug, no :subject) and a
    // "fill the list" run (:slug/:quizId, no :scope or :size) dispatch on the params they lack.
    route('quizzes/history/:slug', 'routes/quizzes.$subject.tsx', { id: 'routes/quizzes.history.$slug' }),
    route('quizzes/history/:slug/:quizId', 'routes/quizzes.$subject.$quizId.tsx', { id: 'routes/quizzes.history.$slug.$quizId' }),
    route('quizzes/:subject/:quizId/:scope/:size', 'routes/quizzes.$subject.$quizId.tsx'),

    // permanent redirects from the old flat /quiz paths (pre-dates the subject layer)
    route('quiz', 'routes/quiz.tsx'),
    route('quiz/:quizId/:scope/:size', 'routes/quiz.$quizId.tsx'),
    route('quiz/:quizId/:size', 'routes/quiz.legacy.tsx'),

    // History nav section: which countries have a timeline, and the timeline itself.
    // Inside the atlas layout now (unlike the first, unlinked render of this route) — the
    // canvas it drives lives in routes/atlas.tsx (AtlasShell), which swaps to it once this
    // route's data reaches AtlasContext. See CLAUDE.md's history exception for what
    // changed and why.
    route('history', 'routes/history.tsx'),
    route('history/:slug', 'routes/history.$slug.tsx')
  ]),

  // Proofreading table for content/history/<file>.yaml — deliberately outside the atlas
  // layout: it has no canvas and needs no AtlasContext.
  route('history/:slug/list', 'routes/history.$slug.list.tsx')
] satisfies RouteConfig;
