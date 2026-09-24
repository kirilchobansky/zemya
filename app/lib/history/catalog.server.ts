/**
 * Server-only access to the built Bulgaria history timeline.
 *
 * Route loaders run at build time (every page is prerendered), so this reads straight
 * from disk. The `.server` suffix guarantees React Router strips it from the client
 * bundle — mirrors app/lib/geography/catalog.server.ts. Converts each authored date
 * string to a decimal year (via app/lib/history/scale.ts's decimalYearOf, which is safe
 * to run here since it's plain portable logic) so the client receives ready-to-render
 * TimelineEntry objects, not raw YAML-shaped strings it would have to reparse.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decimalYearOf } from '~/lib/history/scale';
import type { TimelineEntry } from '~/lib/history/renderer';

interface RawHistoryEntry {
  id: string;
  kind: TimelineEntry['kind'];
  name: { bg: string; en: string };
  start: string;
  end: string | null;
  tier: number;
  parent: string | null;
}

interface RawHistoryDoc {
  version: number;
  entries: RawHistoryEntry[];
}

let cache: TimelineEntry[] | null = null;

function toTimelineEntry(raw: RawHistoryEntry): TimelineEntry {
  const where = `public/data/history/bg.json: "${raw.id}"`;
  return {
    id: raw.id,
    kind: raw.kind,
    tier: raw.tier,
    parent: raw.parent,
    start: decimalYearOf(raw.start, `${where}.start`),
    end: raw.end == null ? null : decimalYearOf(raw.end, `${where}.end`),
    label: raw.name.en || raw.name.bg
  };
}

export function bulgariaTimeline(): TimelineEntry[] {
  if (!cache) {
    const path = join(process.cwd(), 'public', 'data', 'history', 'bg.json');
    const doc = JSON.parse(readFileSync(path, 'utf8')) as RawHistoryDoc;
    cache = doc.entries.map(toTimelineEntry);
  }
  return cache;
}
