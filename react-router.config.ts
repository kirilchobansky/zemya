import type { Config } from '@react-router/dev/config';
import { readFileSync } from 'node:fs';

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

/** Mirrors app/lib/geography/quizzes.ts's QUIZ_DEFINITIONS' ids — a separate literal
 *  because quizzes.ts imports React Stage components and this file is loaded outside the
 *  app's bundler. Scopes and the size ladder come from scopes.ts, which is dependency-free
 *  for exactly this reason, so the prerendered set is derived from the data. */
const QUIZ_IDS = ['countries', 'flags'];

/** Sizes the pre-scope route /quiz/:quizId/:size accepted. That route now only redirects
 *  to the world scope, but the old URLs still need a file to exist on a static host. */
const LEGACY_SIZES = ['20', '30', '50', '90', '120', 'all'];

const quizRuns = QUIZ_IDS.flatMap(id =>
  QUIZ_SCOPES.flatMap(scope =>
    sizesForPool(poolForScope(countries, scope).length).map(size => `/quiz/${id}/${scope}/${size}`)
  )
);
const legacyQuizRuns = QUIZ_IDS.flatMap(id => LEGACY_SIZES.map(size => `/quiz/${id}/${size}`));

/** Pages that existed under a scope key that has since been removed (LEGACY_SCOPES) still
 *  need a file on a static host; the route redirects them. "americas" was offered 10, 20,
 *  30 and All. */
const LEGACY_SCOPE_SIZES = ['10', '20', '30', 'all'];
const legacyScopeRuns = Object.keys(LEGACY_SCOPES).flatMap(scope =>
  QUIZ_IDS.flatMap(id => LEGACY_SCOPE_SIZES.map(size => `/quiz/${id}/${scope}/${size}`))
);

export default {
  ssr: true,
  prerender: () => [
    '/', '/study', '/quiz',
    ...quizRuns,
    ...legacyQuizRuns,
    ...legacyScopeRuns,
    ...slugs.map(slug => `/country/${slug}`)
  ],

  /**
   * Ship the whole route manifest with the first document. The default, lazy discovery,
   * asks the server for `/__manifest` on navigation — there is no server here, so that
   * request 404s and every client-side navigation silently fails to render.
   */
  routeDiscovery: { mode: 'initial' }
} satisfies Config;
