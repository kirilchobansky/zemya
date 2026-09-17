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

export default {
  ssr: true,
  prerender: () => ['/', '/study', ...slugs.map(slug => `/country/${slug}`)],

  /**
   * Ship the whole route manifest with the first document. The default, lazy discovery,
   * asks the server for `/__manifest` on navigation — there is no server here, so that
   * request 404s and every client-side navigation silently fails to render.
   */
  routeDiscovery: { mode: 'initial' }
} satisfies Config;
