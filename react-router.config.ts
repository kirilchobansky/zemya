import type { Config } from '@react-router/dev/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { siteUrl } from './scripts/lib/site.mjs';
import { LEGACY_SCOPES, poolForScope, QUIZ_SCOPES, sizesForPool } from './app/lib/geography/scopes';

/**
 * Every country page is prerendered to static HTML at build time, so `/country/bulgaria`
 * is a real crawlable document rather than an empty div that fills in later. The slug list
 * is emitted by scripts/build-content.mjs, which means adding a country to `content/` and
 * rebuilding is all it takes for its page to exist.
 */
const slugs: string[] = JSON.parse(
  readFileSync('public/data/geography/slugs.json', 'utf8')
);

const countries: { region: string; subregion: string }[] = JSON.parse(
  readFileSync('public/data/geography/countries.json', 'utf8')
);

/** Mirrors app/lib/quiz/subjects.ts's SUBJECTS' ids — a separate literal because that file
 *  imports React (JSX icons/blurbs) and this file is loaded outside the app's bundler. */
const SUBJECT_IDS = ['geography', 'history'];

/** Mirrors app/lib/geography/quizzes.ts's QUIZ_DEFINITIONS' ids — a separate literal
 *  because quizzes.ts imports React Stage components and this file is loaded outside the
 *  app's bundler. Scopes and the size ladder come from scopes.ts, which is dependency-free
 *  for exactly this reason, so the prerendered set is derived from the data. Geography is
 *  the only subject with quizzes today; history has none to prerender runs for. */
const QUIZ_IDS = ['countries', 'flags', 'capitals'];

/** The quizzes that existed before scopes did — only these have old bookmarks to keep
 *  alive, so the legacy redirect pages are prerendered for these and not for newer quizzes. */
const LEGACY_QUIZ_IDS = ['countries', 'flags'];

/** Sizes the pre-scope route /quiz/:quizId/:size accepted. That route now only redirects
 *  to the world scope, but the old URLs still need a file to exist on a static host. */
const LEGACY_SIZES = ['20', '30', '50', '90', '120', 'all'];

const quizRuns = QUIZ_IDS.flatMap(id =>
  QUIZ_SCOPES.flatMap(scope =>
    sizesForPool(poolForScope(countries, scope).length).map(size => `/quizzes/geography/${id}/${scope}/${size}`)
  )
);

/** Every /quiz/* path that ever existed, before the subject layer — kept as permanent
 *  redirect stubs to their /quizzes/geography/* equivalent (routes/quiz.tsx,
 *  quiz.$quizId.tsx, quiz.legacy.tsx). A static host needs a real file for each one. */
const oldCatalogueRuns = QUIZ_IDS.flatMap(id =>
  QUIZ_SCOPES.flatMap(scope =>
    sizesForPool(poolForScope(countries, scope).length).map(size => `/quiz/${id}/${scope}/${size}`)
  )
);
const legacyQuizRuns = LEGACY_QUIZ_IDS.flatMap(id => LEGACY_SIZES.map(size => `/quiz/${id}/${size}`));

/** Pages that existed under a scope key that has since been removed (LEGACY_SCOPES) still
 *  need a file on a static host; the route redirects them. "americas" was offered 10, 20,
 *  30 and All. */
const LEGACY_SCOPE_SIZES = ['10', '20', '30', 'all'];
const legacyScopeRuns = Object.keys(LEGACY_SCOPES).flatMap(scope =>
  LEGACY_QUIZ_IDS.flatMap(id => LEGACY_SCOPE_SIZES.map(size => `/quiz/${id}/${scope}/${size}`))
);

/** Every real page, in one list, so the sitemap can never drift from what is prerendered.
 *  The old-prefix redirect stubs are prerendered (a static host needs a file) but are not
 *  content, so they are prerendered and left out of the sitemap. */
const indexable = [
  '/', '/study', '/quizzes',
  ...SUBJECT_IDS.map(id => `/quizzes/${id}`),
  ...quizRuns,
  ...slugs.map(slug => `/country/${slug}`)
];

/** robots.txt: allow everything and point at the sitemap — except on a Vercel preview
 *  build, which must not compete with the real domain for the same content. (The
 *  X-Robots-Tag header in vercel.json covers the *.vercel.app hosts of every deployment,
 *  production included; this covers the crawlers that only read robots.txt.) */
function robotsTxt(origin: string): string {
  if (process.env.VERCEL_ENV === 'preview') return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}

function sitemapXml(origin: string): string {
  const urls = indexable.map(path => `  <url><loc>${origin}${path === '/' ? '/' : path}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export default {
  ssr: true,
  // '/history/bulgaria': first render of the history timeline, prerendered (a static host
  // needs a real file for every path) but deliberately left out of `indexable` — not
  // linked from anywhere, not in the sitemap, noindex in its own <meta> (see the route
  // and CLAUDE.md's history exception).
  prerender: () => [...indexable, '/quiz', '/history/bulgaria', ...oldCatalogueRuns, ...legacyQuizRuns, ...legacyScopeRuns],

  /** robots.txt and sitemap.xml are generated here, from the same lists that were just
   *  prerendered, and written next to the pages. Never hand-maintained. */
  buildEnd({ reactRouterConfig }) {
    const out = join(reactRouterConfig.buildDirectory, 'client');
    const origin = siteUrl();
    writeFileSync(join(out, 'robots.txt'), robotsTxt(origin));
    writeFileSync(join(out, 'sitemap.xml'), sitemapXml(origin));
  },

  /**
   * Ship the whole route manifest with the first document. The default, lazy discovery,
   * asks the server for `/__manifest` on navigation — there is no server here, so that
   * request 404s and every client-side navigation silently fails to render.
   */
  routeDiscovery: { mode: 'initial' }
} satisfies Config;
