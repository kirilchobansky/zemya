/**
 * Pure helpers behind HistoryTimeline (timeline.ts): clipping to today, content/pannable
 * ranges, filtering, pinned-card target resolution and hit-testing. No DOM, no state.
 */
import type { HitRegion, PinnedCardTarget, TimelineEntry } from './renderer';
import type { EntryKind, TimeRange } from './scale';
import { DEFAULT_CENTER } from './timeline-config';

/** "Nothing is drawn after today": any open-ended span (`end: null` — an ongoing period,
 *  ruler or government) is clipped to `today` rather than left open, and any event dated
 *  after `today` is dropped outright (an event has no duration to clip). */
export function clipEntriesToToday(entries: readonly TimelineEntry[], today: number): TimelineEntry[] {
  return entries
    .filter(e => e.kind !== 'event' || e.start <= today)
    .map(e => (e.end === null ? { ...e, end: today } : e));
}

/** Computes both ranges once from the (already today-clipped) entry list: the raw
 *  content span (earliest authored `start` to `today`) and that span padded by half its
 *  own width on each side for pan clamping. */
export function computeRanges(entries: readonly TimelineEntry[], today: number): { content: TimeRange; pannable: TimeRange } {
  const earliest = entries.length ? Math.min(...entries.map(e => e.start)) : DEFAULT_CENTER - 1;
  const content: TimeRange = { from: earliest, to: Math.max(today, earliest + 1) };
  const half = (content.to - content.from) / 2;
  return { content, pannable: { from: content.from - half, to: content.to + half } };
}

/** The entries a filter leaves visible: never hides a period ("periods are always shown"). */
export function filterEntries(
  allEntries: readonly TimelineEntry[],
  hiddenKinds: ReadonlySet<EntryKind>,
  hiddenCategories: ReadonlySet<string>
): TimelineEntry[] {
  return allEntries.filter(e => {
    if (e.kind !== 'period' && hiddenKinds.has(e.kind)) return false;
    if (e.kind === 'event' && e.category && hiddenCategories.has(e.category)) return false;
    return true;
  });
}

/** Every pinnedCardRects entry resolved against allEntries (never the filtered
 *  `entries` — a pinned card whose kind/category is currently hidden still needs a real
 *  target to point its connector line at) into renderer.ts's PinnedCardTarget shape. An
 *  id with no matching entry (shouldn't happen — atlas.tsx only ever pins a real one) is
 *  silently skipped. */
export function resolvePinnedTargets(
  allEntries: readonly TimelineEntry[],
  rects: ReadonlyMap<string, { x: number; y: number; w: number; h: number }>
): readonly PinnedCardTarget[] {
  const out: PinnedCardTarget[] = [];
  for (const [id, rect] of rects) {
    const entry = allEntries.find(e => e.id === id);
    if (entry) out.push({ id, kind: entry.kind, start: entry.start, end: entry.end, rect });
  }
  return out;
}

/** Point-in-rect hit-test against last frame's regions: nearest to the pointer (by
 *  distance to the region's own centre) among those containing the point; ties go to
 *  the lower tier number, then id — see the module header. */
export function hitTestRegions(hits: readonly HitRegion[], x: number, y: number): HitRegion | null {
  let best: HitRegion | null = null;
  let bestDist = Infinity;
  for (const h of hits) {
    if (x < h.x || x > h.x + h.w || y < h.y || y > h.y + h.h) continue;
    const dist = Math.hypot(x - (h.x + h.w / 2), y - (h.y + h.h / 2));
    const tie = dist === bestDist;
    if (!best || dist < bestDist || (tie && (h.tier < best.tier || (h.tier === best.tier && h.id < best.id)))) {
      best = h;
      bestDist = dist;
    }
  }
  return best;
}
