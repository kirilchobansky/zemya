/**
 * Pure search over the Bulgaria history timeline (app/components/HistorySearch.tsx) — no
 * React, no canvas. Case-insensitive substring match against name, aliases (Cyrillic and
 * Latin — see catalog.server.ts), role and tags; cheap enough over ~700 entries to run on
 * every keystroke with no debounce.
 *
 * Ranking, best first: name starts with the query, then name contains it, then an alias
 * matches, then a tag or role matches — a match at a coarser tier never loses to one at a
 * finer tier regardless of where in the string it falls. Ties (same tier) go to the
 * earlier date, so a period search doesn't surface a stray 20th-century event first.
 */
import type { TimelineEntry } from './renderer';

const TIER_NAME_STARTS = 0;
const TIER_NAME_CONTAINS = 1;
const TIER_ALIAS = 2;
const TIER_TAG_OR_ROLE = 3;

function tierFor(entry: TimelineEntry, q: string): number | null {
  const name = entry.label.toLowerCase();
  if (name.startsWith(q)) return TIER_NAME_STARTS;
  if (name.includes(q)) return TIER_NAME_CONTAINS;
  if (entry.aliases.some(a => a.toLowerCase().includes(q))) return TIER_ALIAS;
  if ((entry.role && entry.role.toLowerCase().includes(q)) || entry.tags.some(t => t.toLowerCase().includes(q))) {
    return TIER_TAG_OR_ROLE;
  }
  return null;
}

export function search(entries: readonly TimelineEntry[], query: string, limit = 8): TimelineEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { entry: TimelineEntry; tier: number }[] = [];
  for (const entry of entries) {
    const tier = tierFor(entry, q);
    if (tier !== null) scored.push({ entry, tier });
  }
  scored.sort((a, b) => a.tier - b.tier || a.entry.start - b.entry.start);
  return scored.slice(0, limit).map(s => s.entry);
}
