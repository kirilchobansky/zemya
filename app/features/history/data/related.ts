/**
 * Pure helpers for the history detail view (app/features/history/components/HistoryDetail.tsx) — no React,
 * no canvas. Everything here works on already-converted decimal-year TimelineEntry objects,
 * same discipline as layout.ts.
 */
import type { TimelineEntry } from '~/features/history/timeline/renderer';

function endOf(e: Pick<TimelineEntry, 'end' | 'start'>): number {
  return e.end ?? Infinity;
}

function overlaps(a: TimelineEntry, b: TimelineEntry): boolean {
  return a.start <= endOf(b) && b.start <= endOf(a);
}

function byStartThenId(a: TimelineEntry, b: TimelineEntry): number {
  return a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Every entry overlapping [from, to] whose tier is `maxTier` or better (lower) — the
 *  detail view's "During this reign" / "Rulers" / "Key events" lists filter further by
 *  kind themselves; this only does the date+tier cut, sorted chronologically. */
export function entriesInSpan(entries: readonly TimelineEntry[], from: number, to: number, maxTier: number): TimelineEntry[] {
  return entries.filter(e => e.tier <= maxTier && endOf(e) >= from && e.start <= to).sort(byStartThenId);
}

export interface Neighbours {
  previous: TimelineEntry | null;
  next: TimelineEntry | null;
}

/** The previous and next entry of the same kind AND role, ordered by start — an entry
 *  whose span overlaps `entry`'s own counts as a co-ruler, not a previous/next one, so it's
 *  excluded from both. */
export function neighbours(entry: TimelineEntry, entries: readonly TimelineEntry[]): Neighbours {
  const siblings = entries
    .filter(e => e.id !== entry.id && e.kind === entry.kind && e.role === entry.role && !overlaps(e, entry))
    .sort(byStartThenId);

  let previous: TimelineEntry | null = null;
  let next: TimelineEntry | null = null;
  for (const s of siblings) {
    if (s.start < entry.start && (!previous || s.start > previous.start)) previous = s;
    if (s.start > entry.start && (!next || s.start < next.start)) next = s;
  }
  return { previous, next };
}

/** Up to `limit` other entries sharing at least one tag with `entry`, sorted by date. */
export function relatedByTags(entry: TimelineEntry, entries: readonly TimelineEntry[], limit: number): TimelineEntry[] {
  if (entry.tags.length === 0) return [];
  const tagSet = new Set(entry.tags);
  return entries
    .filter(e => e.id !== entry.id && e.tags.some(t => tagSet.has(t)))
    .sort(byStartThenId)
    .slice(0, limit);
}
