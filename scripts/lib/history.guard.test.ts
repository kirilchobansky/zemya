/**
 * scripts/lib/history.mjs is no longer build-time-only: app/lib/history/scale.ts imports
 * it straight into the client bundle (see scale.ts's own header comment and CLAUDE.md's
 * "Where this is" for why that's safe today). This guards the invariant that makes it
 * safe — a Node builtin creeping in here would break silently in the browser, not at
 * typecheck or build time, so it needs its own explicit check.
 *
 *   npm run test:unit
 */
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const BUILTIN = new Set(builtinModules);
const SOURCE_PATH = join(process.cwd(), 'scripts/lib/history.mjs');

function importedSpecifiers(source: string): string[] {
  const fromImports = [...source.matchAll(/\bimport\s+(?:[\s\S]*?\bfrom\s+)?['"]([^'"]+)['"]/g)].map(m => m[1]);
  const fromRequires = [...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
  const fromDynamicImports = [...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
  return [...fromImports, ...fromRequires, ...fromDynamicImports];
}

describe('scripts/lib/history.mjs has zero Node dependencies', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8');

  it('imports nothing at all — the simplest way to guarantee no Node builtin sneaks in', () => {
    expect(importedSpecifiers(source)).toEqual([]);
  });

  it('(explicit check, in case the module gains imports later) never a Node builtin', () => {
    const bad = importedSpecifiers(source).filter(
      spec => spec.startsWith('node:') || BUILTIN.has(spec.split('/')[0])
    );
    expect(bad).toEqual([]);
  });
});
