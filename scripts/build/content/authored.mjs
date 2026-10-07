import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { root } from './config.mjs';

/** content/geography/countries/*.yaml, validated, keyed by ISO3. */
export function loadAuthored() {
  const dir = join(root, 'content', 'geography', 'countries');
  const authored = {};
  const slugs = new Set();

  for (const file of readdirSync(dir).filter(f => f.endsWith('.yaml'))) {
    const doc = parse(readFileSync(join(dir, file), 'utf8'));
    const where = `content/geography/countries/${file}`;
    for (const field of ['iso3', 'slug', 'name', 'religion', 'flag', 'outline', 'hook']) {
      if (!doc?.[field]) throw new Error(`${where}: missing required field "${field}"`);
    }
    if (`${doc.slug}.yaml` !== file) throw new Error(`${where}: slug "${doc.slug}" does not match filename`);
    if (slugs.has(doc.slug)) throw new Error(`${where}: duplicate slug "${doc.slug}"`);
    if (authored[doc.iso3]) throw new Error(`${where}: duplicate iso3 "${doc.iso3}"`);
    slugs.add(doc.slug);
    authored[doc.iso3] = doc;
  }
  return authored;
}
