/**
 * Absolute URLs. SITE_URL is injected at build time by vite.config.ts (from
 * scripts/lib/site.mjs), so client and prerender agree and nothing here is a literal domain.
 */
declare const __SITE_URL__: string;

export const SITE_URL: string = __SITE_URL__;

export function absoluteUrl(path: string): string {
  return path === '/' ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}
