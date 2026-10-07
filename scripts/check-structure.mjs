/**
 * Structure check: `npm run check` (also the first step of `npm test`). Read-only. Fails on
 *
 *   1. a source file under app/, scripts/ or tests/ over 300 lines (.css included). There is no
 *      allow-list: a file that grows past the limit is split by purpose, and
 *   2. an import that breaks the dependency rules in docs/structure.md:
 *        - app/shared imports nothing from app/features, app/engines or app/routes
 *        - app/engines imports no React (react, react-dom, react-router) and nothing from
 *          app/features, app/shared or app/routes
 *        - app/features/progress imports nothing from app/features/countries
 *        - a feature imports another feature only through its index.ts (`~/features/<name>`);
 *          a `*.server.ts` file cannot be re-exported (it would leak into the client bundle), so
 *          those are the one deep import allowed (and unit tests, which mock real module paths,
 *          and `.css` files, which are not exports)
 *        - nothing outside a feature (routes included) reaches into a feature's folders
 *
 * Imports are resolved to files first, so `./x`, `../x` and `~/x` are judged the same way.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_LINES = 300; // every source file and every stylesheet; CSS is split by component/purpose, never mid-rule

/** Deep cross-feature imports that cannot go through an index. Keep this list near-empty. */
const DEEP_IMPORT_ALLOW_LIST = new Map([
  ['app/features/quizzes/history-fill/fill-quiz.ts',
    'react-router.config.ts loads it at build time; that loader resolves neither `~` nor a barrel of components'],
  ['app/features/quizzes/history-fill/fill-matching.ts',
    'the matching half of fill-quiz.ts, loaded by the same build-time config loader (same reason)']
]);

const SOURCE = /\.(ts|tsx|mjs|mts|css)$/;
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SOURCE.test(name) && !name.endsWith('.d.mts')) out.push(relative(root, p).split(sep).join('/'));
  }
  return out;
}
const files = [...walk(join(root, 'app')), ...walk(join(root, 'scripts'))];
const fileSet = new Set(files);
const linted = [...files, ...walk(join(root, 'tests'))]; // tests/ is held to the line limit too
const problems = [];

// 1. line limit
for (const f of linted) {
  const text = readFileSync(join(root, f), 'utf8');
  const lines = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
  if (lines > MAX_LINES) problems.push(`${f}: ${lines} lines (limit ${MAX_LINES}) — split it`);
}

// 2. imports
const EXT = ['', '.ts', '.tsx', '.mjs', '.mts', '.css', '/index.ts', '/index.tsx'];
const specs = text => {
  const out = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.mock\(\s*)(['"])([^'"\n]+)\1/g;
  for (const m of text.matchAll(re)) out.push(m[2]);
  return out;
};
const resolveSpec = (from, spec) => {
  const base = spec.startsWith('~/') ? 'app/' + spec.slice(2) : spec.startsWith('.') ? posix.join(posix.dirname(from), spec) : null;
  if (!base) return null;
  for (const e of EXT) if (fileSet.has(base + e)) return base + e;
  return null;
};
const zone = f => {
  let m;
  if (f.startsWith('app/shared/')) return { kind: 'shared' };
  if (f.startsWith('app/engines/')) return { kind: 'engines' };
  if ((m = f.match(/^app\/features\/([^/]+)\/(.*)$/))) return { kind: 'feature', name: m[1], rest: m[2] };
  if (f.startsWith('app/routes/') || /^app\/[^/]+\.tsx?$/.test(f)) return { kind: 'routes' };
  return { kind: 'other' };
};
for (const f of files.filter(x => x.startsWith('app/') && !x.endsWith('.css'))) {
  const text = readFileSync(join(root, f), 'utf8');
  const from = zone(f);
  for (const spec of specs(text)) {
    if (from.kind === 'engines' && /^(react|react-dom|react-router)(\/|$)/.test(spec)) problems.push(`${f}: engines must not import React (${spec})`);
    const target = resolveSpec(f, spec);
    if (!target) continue;
    const to = zone(target);
    const bad = why => problems.push(`${f}: imports ${spec} — ${why}`);
    if (from.kind === 'shared' && ['feature', 'engines', 'routes'].includes(to.kind)) bad(`shared imports nothing from ${to.kind}`);
    if (from.kind === 'engines' && ['feature', 'shared', 'routes'].includes(to.kind)) bad(`engines import nothing from ${to.kind}`);
    if (to.kind === 'routes' && from.kind !== 'routes') bad('only routes import route modules');
    if (to.kind === 'feature' && !(from.kind === 'feature' && from.name === to.name)) {
      if (from.kind === 'feature' && from.name === 'progress' && to.name === 'countries') bad('features/progress imports nothing from features/countries');
      const viaIndex = to.rest === 'index.ts';
      const server = /\.server\.tsx?$/.test(target) || target.endsWith('.css'); // stylesheets are not exports
      // tests may mock or probe a module directly (vi.mock needs the real module path)
      if (!viaIndex && !server && !f.endsWith('.test.ts') && !DEEP_IMPORT_ALLOW_LIST.has(f)) bad(`reach into features/${to.name} only through ~/features/${to.name}`);
    }
  }
}

if (problems.length) {
  console.error(`check-structure: ${problems.length} problem(s)\n` + problems.map(p => '  ' + p).join('\n'));
  process.exit(1);
}
console.log(`check-structure: ok (${linted.length} files, none over ${MAX_LINES} lines)`);
