/**
 * Content pipeline: content/history/*.yaml -> public/data/history/*.json
 *
 * One output file per input file (content/history/bg.yaml -> public/data/history/bg.json),
 * mirroring content/geography/countries/*.yaml's one-file-per-entity shape. Kept as its
 * own script rather than folded into build-content.mjs on purpose: geography and history
 * share no upstream joins, geometry or aliasing, and CLAUDE.md's rule that app/lib/core/
 * stay subject-agnostic extends to the build step too — a bug in one pipeline must never
 * be able to break the other. Wired into `npm run build:content` alongside it.
 *
 *   node scripts/build-history.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { validateHistory } from './lib/history.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'content', 'history');
const outDir = join(root, 'public', 'data', 'history');
mkdirSync(outDir, { recursive: true });

const files = readdirSync(dir).filter(f => f.endsWith('.yaml'));
if (!files.length) throw new Error(`content/history: no .yaml files found in ${dir}`);

let totalEntries = 0;
for (const file of files) {
  const code = basename(file, '.yaml');
  const where = `content/history/${file}`;
  const doc = parse(readFileSync(join(dir, file), 'utf8'));
  const entries = validateHistory(doc, where);

  const payload = { version: 1, entries };
  writeFileSync(join(outDir, `${code}.json`), JSON.stringify(payload), 'utf8');
  totalEntries += entries.length;
  console.log(`history ${code}   ${entries.length} entries`);
}

console.log(`history files    ${files.length}`);
console.log(`history entries  ${totalEntries}`);
