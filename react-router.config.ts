import type { Config } from '@react-router/dev/config';
import { readFileSync } from 'node:fs';

/**
 * Every country page is prerendered to static HTML at build time, so `/country/bulgaria`
 * is a real crawlable document rather than an empty div that fills in later. The slug list
 * is emitted by scripts/build-content.mjs, which means adding a country to `content/` and
 * rebuilding is all it takes for its page to exist.
 */
const slugs: string[] = JSON.parse(
  readFileSync('public/data/geography/slugs.json', 'utf8')
);

/** Mirrors app/lib/geography/quizzes.ts's QUIZ_SIZES and QUIZ_DEFINITIONS' ids — kept as
 *  separate literals because this config file is loaded directly, not bundled through the
 *  `~` alias, the same way scripts/build-content.mjs duplicates a couple of app/lib
 *  constants of its own. */
const QUIZ_SIZES = ['20', '30', '50', '90', '120', 'all'];
const QUIZ_IDS = ['countries'];

export default {
  ssr: true,
  prerender: () => [
    '/', '/study', '/quiz',
    ...QUIZ_IDS.flatMap(id => QUIZ_SIZES.map(size => `/quiz/${id}/${size}`)),
    ...slugs.map(slug => `/country/${slug}`)
  ],

  /**
   * Ship the whole route manifest with the first document. The default, lazy discovery,
   * asks the server for `/__manifest` on navigation — there is no server here, so that
   * request 404s and every client-side navigation silently fails to render.
   */
  routeDiscovery: { mode: 'initial' }
} satisfies Config;
