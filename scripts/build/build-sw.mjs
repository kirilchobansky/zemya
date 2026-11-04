/**
 * Writes build/client/sw.js: the file list of the built site plus a version hash of its
 * contents, spliced into scripts/build/sw.template.js. Runs last in `npm run build`.
 * No dependencies. Strategy: docs/decisions.md "Offline".
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, 'build/client');

// Not for the offline app: the worker itself, share/SEO files, and world.json (a tile build
// input the client never fetches).
const EXCLUDE = new Set(['sw.js', 'og-image.png', 'sitemap.xml', 'robots.txt', 'data/geography/world.json']);
const isCore = path =>
  path === 'index.html' || path === '404.html' || path === 'manifest.webmanifest' ||
  path.startsWith('assets/') || path.startsWith('data/') ||
  /^(icon|apple-touch-icon|favicon)[^/]*$/.test(path);

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

const paths = (await walk(out)).map(f => relative(out, f).split(sep).join('/')).filter(p => !EXCLUDE.has(p)).sort();
const hash = createHash('sha256');
const sizes = new Map();
for (const path of paths) {
  const bytes = await readFile(join(out, path));
  sizes.set(path, bytes.length);
  hash.update(path + '\0').update(bytes);
}
const version = hash.digest('hex').slice(0, 12);
const url = path => '/' + path.split('/').map(encodeURIComponent).join('/');
const core = paths.filter(isCore).map(url);
const rest = paths.filter(p => !isCore(p)).map(url);

const template = await readFile(join(root, 'scripts/build/sw.template.js'), 'utf8');
const source = template
  .replace('__VERSION__', version)
  .replace('__CORE__', JSON.stringify(core))
  .replace('__REST__', JSON.stringify(rest));
await writeFile(join(out, 'sw.js'), source);

const sum = list => list.reduce((n, p) => n + sizes.get(p), 0);
const mb = n => (n / 1048576).toFixed(1) + ' MB';
const coreBytes = sum(paths.filter(isCore));
const restBytes = sum(paths.filter(p => !isCore(p)));
console.log(
  `sw.js ${version}: ${core.length} core files (${mb(coreBytes)}) + ${rest.length} background files ` +
  `(${mb(restBytes)}) = ${mb(coreBytes + restBytes)} precache`
);
