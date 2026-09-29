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
import { decimalYearOf, KIND_RANK } from '~/lib/history/scale';
import type { TimelineEntry } from '~/lib/history/renderer';

interface RawHistoryEntry {
  id: string;
  kind: TimelineEntry['kind'];
  name: { bg: string; en: string };
  role: string | null;
  start: string;
  end: string | null;
  precision: 'exact' | 'year' | 'circa' | 'disputed';
  style: 'old' | 'new';
  tier: number;
  parent: string | null;
  category: string | null;
  color: string | null;
  blurb: { bg: string; en: string };
  tags: string[];
}

interface RawHistoryDoc {
  version: number;
  entries: RawHistoryEntry[];
}

/** One row for the proofreading list view (routes/history.bulgaria.list.tsx) — the
 *  authored fields as-is, no decimal-year conversion (that's TimelineEntry's job, for the
 *  canvas only). */
export interface HistoryListRow {
  id: string;
  kind: RawHistoryEntry['kind'];
  role: string | null;
  nameBg: string;
  start: string;
  end: string | null;
  tier: number;
  precision: RawHistoryEntry['precision'];
  category: string | null;
  parent: string | null;
}

let rawCache: RawHistoryEntry[] | null = null;
let cache: TimelineEntry[] | null = null;

function rawEntries(): RawHistoryEntry[] {
  if (!rawCache) {
    const path = join(process.cwd(), 'public', 'data', 'history', 'bg.json');
    const doc = JSON.parse(readFileSync(path, 'utf8')) as RawHistoryDoc;
    rawCache = doc.entries;
  }
  return rawCache;
}

function toTimelineEntry(raw: RawHistoryEntry): TimelineEntry {
  const where = `public/data/history/bg.json: "${raw.id}"`;
  const start = decimalYearOf(raw.start, `${where}.start`);
  return {
    id: raw.id,
    kind: raw.kind,
    tier: raw.tier,
    parent: raw.parent,
    role: raw.role,
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
    label: raw.name.bg,
    blurbBg: raw.blurb.bg,
    category: raw.category,
    color: raw.color,
    precision: raw.precision,
    tags: raw.tags,
    style: raw.style
  };
}

export function bulgariaTimeline(): TimelineEntry[] {
  if (!cache) cache = rawEntries().map(toTimelineEntry);
  return cache;
}

/** Plain rows for the proofreading list view — sorted by start year (numeric, so "-450"
 *  sorts before "632"), then kind, in the fixed period/ruler/government/event order
 *  scale.ts's KIND_RANK already defines for the canvas, so the two views agree. */
export function bulgariaHistoryList(): HistoryListRow[] {
  return rawEntries()
    .map(raw => ({
      id: raw.id,
      kind: raw.kind,
      role: raw.role,
      nameBg: raw.name.bg,
      start: raw.start,
      end: raw.end,
      tier: raw.tier,
      precision: raw.precision,
      category: raw.category,
      parent: raw.parent
    }))
    .sort((a, b) => parseInt(a.start, 10) - parseInt(b.start, 10) || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}
