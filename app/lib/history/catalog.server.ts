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
  const start = decimalYearOf(raw.start, `${where}.start`);
  return {
    id: raw.id,
    kind: raw.kind,
    tier: raw.tier,
    parent: raw.parent,
    start,
    // `end: null` means "ongoing" for a period/ruler/government (scale.ts's
    // visibleEntries treats it as extending to +Infinity, correctly — the Republic of
    // Bulgaria has no end date because it hasn't ended). An EVENT with no authored end is
    // a different thing: a single moment, not an open-ended span. Falling through to the
    // same +Infinity would make every undated-end event "ongoing" from its date forward,
    // so it would incorrectly still count as visible (and its pin would still draw) in
    // any later view's culling — caught by an actual render showing an 1185 event pin
    // while centred on 1247. Collapsing it to `start` here, once, is cheaper and more
    // obviously correct than teaching the generic, kind-agnostic scale.ts/layout.ts
    // pipeline a kind-specific exception.
    end: raw.end == null ? (raw.kind === 'event' ? start : null) : decimalYearOf(raw.end, `${where}.end`),
    // Bulgarian, not English: this is a Bulgarian history timeline, and the canvas font
    // stack (app/lib/history/timeline.ts) is chosen to cover Cyrillic specifically for it.
    label: raw.name.bg
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
