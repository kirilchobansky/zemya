/** The timeline's zoom levels, entry kinds and every tuning constant (see scale.ts for the module overview). */
export type ZoomLevel = 'millennium' | 'century' | 'decade' | 'year' | 'month' | 'day';
export type EntryKind = 'period' | 'ruler' | 'government' | 'event';
export type TickWeight = 'major' | 'minor';

/** Coarsest first. Every table below is keyed by this same order. */
export const ZOOM_LEVELS: readonly ZoomLevel[] = ['millennium', 'century', 'decade', 'year', 'month', 'day'];
export const COARSE_LEVELS: ReadonlySet<ZoomLevel> = new Set(['millennium', 'century', 'decade']);

/**
 * All tuning constants in one place, per the brief — nothing below this object hardcodes
 * a threshold or a tier number; every visibility or zoom-level decision reads it from here.
 */
export const CONFIG = {
  /** visibleRangeOverscan's default: how much wider than the viewport the culled range is. */
  overscanFactor: 1.5,
  /**
   * Ascending by minPxPerYear. levelFor() picks the FINEST level whose threshold is met —
   * e.g. at pxPerYear = 10 (between the year and month thresholds), the active level is
   * "year". The first entry's threshold is nominal (0): pxPerYear is never negative, so
   * "millennium" is always the floor.
   */
  zoomThresholds: [
    { level: 'millennium' as const, minPxPerYear: 0 },
    { level: 'century' as const, minPxPerYear: 0.08 },
    { level: 'decade' as const, minPxPerYear: 0.8 },
    { level: 'year' as const, minPxPerYear: 8 },
    { level: 'month' as const, minPxPerYear: 96 },
    { level: 'day' as const, minPxPerYear: 2400 }
  ],
  /** Target number of labelled major ticks on screen at any zoom — niceStep() below picks
   *  a round step (1/2/5 x a power of ten) near visibleSpan/tickTargetCount, so the axis
   *  reads "roughly 6-10 ticks", not one every fixed N years regardless of how many that
   *  puts on screen. */
  tickTargetCount: 8,
  /** Hard ceiling on pxPerYear: zoom cannot go further in than roughly day-level
   *  granularity with comfortably spaced labels. Distinct from zoomThresholds' day entry
   *  (that's where day ticks switch ON, not a camera limit) — see clampPxPerYear. */
  maxPxPerYear: 20000,
  /**
   * Highest entry.tier visible per (zoom level, entry kind). 0 means "never at this
   * level, regardless of tier". Only the `event` column is consulted by the actual render
   * path (app/features/history/timeline/renderer.ts's eventTierReveal) — period/ruler/government are
   * always drawn there regardless of zoom or tier ("the calm overview" — periods are
   * always the hero, rulers/governments always draw as bars, thin strips with no text at
   * far zoom). The other three columns remain meaningful only to
   * app/features/history/timeline/layout.ts's densityBuckets (not currently wired into the UI) and its
   * own tests — kept as they were rather than repurposed, so that unrelated code doesn't
   * shift underfoot. Event ladder: tier 1 always, tier 2 from decade zoom, tier 3 from
   * year zoom, everything from month zoom on — renderer.ts fades each tier in smoothly
   * across the zoom band leading up to its own unlock level, rather than a hard cutoff.
   */
  maxTier: {
    millennium: { period: 1, ruler: 0, government: 0, event: 1 },
    century: { period: 2, ruler: 2, government: 0, event: 1 },
    decade: { period: 3, ruler: 3, government: 2, event: 2 },
    year: { period: 4, ruler: 4, government: 4, event: 3 },
    month: { period: 5, ruler: 4, government: 3, event: 5 },
    day: { period: 5, ruler: 5, government: 5, event: 5 }
  } satisfies Record<ZoomLevel, Record<EntryKind, number>>
} as const;
