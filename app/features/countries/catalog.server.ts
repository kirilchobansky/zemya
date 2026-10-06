/**
 * Server-only access to the built country facts.
 *
 * Route loaders run at build time (every page is prerendered), so this reads straight
 * from disk. The `.server` suffix guarantees React Router strips it from the client
 * bundle — none of this, and none of the 153 KB it reads, ever reaches a browser.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CountryRecord } from '~/lib/map/types';

let cache: CountryRecord[] | null = null;

export function allCountries(): CountryRecord[] {
  if (!cache) {
    const path = join(process.cwd(), 'public', 'data', 'geography', 'countries.json');
    cache = JSON.parse(readFileSync(path, 'utf8')) as CountryRecord[];
  }
  return cache;
}

export function countryBySlug(slug: string): CountryRecord | undefined {
  return allCountries().find(c => c.slug === slug);
}

/** Neighbours resolved to the minimum a link needs. */
export function neighbourLinks(country: CountryRecord) {
  const byIso3 = new Map(allCountries().map(c => [c.iso3, c]));
  return country.borders
    .map(iso3 => byIso3.get(iso3))
    .filter((c): c is CountryRecord => Boolean(c))
    .map(c => ({ slug: c.slug, name: c.name, emoji: c.emoji }));
}
