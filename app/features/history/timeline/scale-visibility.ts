/** Which entries show at which zoom: the fixed draw order, the tier ladder and the culling. */
import { CONFIG, type EntryKind, type ZoomLevel } from './scale-config';
import { levelFor, visibleRangeOverscan, type Viewport } from './scale-viewport';

/* -------------------------------------------------------------------------------- visibility */

/** Fixed draw/layout order — period, then ruler, then government, then event — so two
 *  entries' relative order never flips as the viewport pans or zooms; only which entries
 *  are included changes. */
export const KIND_RANK: Readonly<Record<EntryKind, number>> = { period: 0, ruler: 1, government: 2, event: 3 };

export function kindRank(kind: EntryKind): number {
  return KIND_RANK[kind];
}

/** The highest tier still visible for `kind` at `level` — CONFIG.maxTier looked up and
 *  nothing else; 0 (or below `kind`'s own minimum tier) means never visible at this level. */
export function maxTierFor(level: ZoomLevel, kind: EntryKind): number {
  return CONFIG.maxTier[level][kind];
}

/** A timeline entry reduced to what this module needs: already-converted decimal-year
 *  bounds (see decimalYearOfDate), not the raw authored strings. `end: null` means
 *  ongoing — ranges as far as the caller's "now", i.e. it overlaps every range whose
 *  start it is past. */
export interface HistoryEntry {
  id: string;
  kind: EntryKind;
  tier: number;
  start: number;
  end: number | null;
}

/**
 * Culls `entries` to the overscan range and to what `maxTierFor` allows at the current
 * zoom, then sorts by kindRank (primary) and start (secondary) — see KIND_RANK's comment
 * on why that order is fixed rather than incidental. Not used by the render path itself
 * any more (renderer.ts's render() does its own range-only culling — see that file's
 * rangeVisible — since period/ruler/government are never tier-filtered there); kept here
 * for callers, like layout.ts's densityBuckets, that still want the old tier-aware cull.
 */
export function visibleEntries<T extends HistoryEntry>(entries: readonly T[], viewport: Viewport): T[] {
  const level = levelFor(viewport.pxPerYear);
  const { from, to } = visibleRangeOverscan(viewport);

  return entries
    .filter(e => {
      const max = maxTierFor(level, e.kind);
      if (max <= 0 || e.tier > max) return false;
      const end = e.end ?? Infinity;
      return end >= from && e.start <= to;
    })
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.start - b.start);
}
