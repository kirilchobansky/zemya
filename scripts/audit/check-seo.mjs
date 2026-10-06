/**
 * Checks the built output directly (run after `npm run build`):
 *   - robots.txt and sitemap.xml exist; the sitemap lists exactly the indexable pages
 *     (every prerendered page except the noindex legacy redirects)
 *   - no two indexable pages share a <title> or a description
 *   - every page has exactly one canonical, absolute, on SITE_URL; the sitemap agrees
 *   - every page has one h1-or-none problem-free head: og:title/description/url/image,
 *     twitter:card; country pages have JSON-LD that parses
 * Exits 1 with every failure listed.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { siteUrl } from './lib/site.mjs';

const ROOT = join('build', 'client');
const origin = siteUrl();
const problems = [];
const fail = msg => problems.push(msg);

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (dir === ROOT && ['assets', 'flags', 'data'].includes(name)) continue;
      yield* htmlFiles(path);
    } else if (name.endsWith('.html') && name !== '404.html') yield path;
  }
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const tags = (html, re) => [...html.matchAll(re)].map(m => decode(m[1]));

const pages = [];
for (const file of htmlFiles(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const path = rel === 'index.html' ? '/' : '/' + rel.replace(/(\/index)?\.html$/, '');
  const html = readFileSync(file, 'utf8');
  pages.push({
    path,
    html,
    title: tags(html, /<title>([^<]*)<\/title>/g),
    canonical: tags(html, /<link[^>]*rel="canonical"[^>]*href="([^"]*)"/g),
    noindex: /<meta[^>]*name="robots"[^>]*content="noindex/.test(html),
    description: tags(html, /<meta[^>]*name="description"[^>]*content="([^"]*)"/g)
  });
}
const indexable = pages.filter(p => !p.noindex);

for (const f of ['robots.txt', 'sitemap.xml']) if (!existsSync(join(ROOT, f))) fail(`${f} is missing`);

if (existsSync(join(ROOT, 'sitemap.xml'))) {
  const locs = tags(readFileSync(join(ROOT, 'sitemap.xml'), 'utf8'), /<loc>([^<]*)<\/loc>/g);
  const expected = new Set(indexable.map(p => origin + (p.path === '/' ? '/' : p.path)));
  if (locs.length !== new Set(locs).size) fail('sitemap has duplicate URLs');
  if (locs.length !== expected.size) fail(`sitemap has ${locs.length} URLs, build has ${expected.size} indexable pages`);
  for (const url of expected) if (!locs.includes(url)) fail(`sitemap lacks ${url}`);
  for (const url of locs) if (!expected.has(url)) fail(`sitemap lists ${url}, which is not an indexable page`);
  console.log(`sitemap: ${locs.length} URLs; ${pages.length} pages prerendered (${pages.length - indexable.length} noindex redirects)`);
}

const seen = new Map();
for (const p of pages) {
  if (p.title.length !== 1) fail(`${p.path}: ${p.title.length} <title> tags`);
  if (p.canonical.length !== 1) fail(`${p.path}: ${p.canonical.length} canonical tags`);
  else if (!p.canonical[0].startsWith(origin + '/')) fail(`${p.path}: canonical ${p.canonical[0]} is not on ${origin}`);
  if (p.noindex) continue;
  const expectedCanonical = origin + (p.path === '/' ? '/' : p.path);
  if (p.canonical[0] !== expectedCanonical) fail(`${p.path}: canonical is ${p.canonical[0]}, expected ${expectedCanonical}`);
  for (const [kind, values] of [['title', p.title], ['description', p.description]]) {
    const key = `${kind}:${values[0]}`;
    if (seen.has(key)) fail(`${p.path} and ${seen.get(key)} share a ${kind}: ${values[0]}`);
    else seen.set(key, p.path);
  }
  for (const needle of ['og:title', 'og:description', 'og:url', 'og:type', 'og:image']) {
    if (!p.html.includes(`property="${needle}"`)) fail(`${p.path}: no ${needle}`);
  }
  if (!p.html.includes('name="twitter:card" content="summary_large_image"')) fail(`${p.path}: no twitter:card`);
  const h1 = (p.html.match(/<h1[ >]/g) ?? []).length;
  if (h1 !== 1) fail(`${p.path}: ${h1} <h1> elements`);
  if (!/<html lang="en"/.test(p.html)) fail(`${p.path}: no lang="en"`);
  const ld = [...p.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const m of ld) {
    try { JSON.parse(decode(m[1])); } catch (e) { fail(`${p.path}: JSON-LD does not parse (${e.message})`); }
  }
  if (p.path.startsWith('/country/') && ld.length !== 1) fail(`${p.path}: ${ld.length} JSON-LD blocks`);
  if (p.path === '/' && ld.length !== 1) fail(`/: ${ld.length} JSON-LD blocks`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n` + problems.slice(0, 60).map(p => '  ✗ ' + p).join('\n'));
  process.exit(1);
}
console.log(`ok: ${indexable.length} indexable pages — unique titles and descriptions, one absolute canonical each, OG/Twitter tags, JSON-LD parses`);
