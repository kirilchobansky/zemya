/**
 * The history timeline's time axis: decimal-year time representation, viewport
 * projection, the zoom ladder and tier-based visibility. Pure logic, mirroring
 * app/lib/map/projection.ts + camera.ts for the geography side (no React, no canvas, no
 * DOM) — CLAUDE.md already anticipated this module when it said the map's projection and
 * the history timeline would share a renderer-agnostic shape.
 *
 * Never uses `Date`: dates before 1 April 1916 are old style (Julian), and `Date` would
 * silently shift them onto the Gregorian calendar. A "day" here is one of 31 equal-width
 * synthetic slots within a month (see decimalYearOfDate below) — a uniform axis position,
 * not a claim that every month has 31 real days. That keeps every conversion in this file
 * exact and invertible without a days-in-month or leap-year table.
 *
 * The date parser (scripts/lib/history.mjs) is the single canonical implementation,
 * reused here rather than duplicated — it has zero Node dependencies, so it bundles into
 * the client exactly as any other pure-logic module would.
 */
import { dateKey, parseHistoryDate, type ParsedHistoryDate } from '../../../scripts/lib/history.mjs';

export type ZoomLevel = 'millennium' | 'century' | 'decade' | 'year' | 'month' | 'day';
export type EntryKind = 'period' | 'ruler' | 'government' | 'event';
export type TickWeight = 'major' | 'minor';

/** Coarsest first. Every table below is keyed by this same order. */
export const ZOOM_LEVELS: readonly ZoomLevel[] = ['millennium', 'century', 'decade', 'year', 'month', 'day'];
const COARSE_LEVELS: ReadonlySet<ZoomLevel> = new Set(['millennium', 'century', 'decade']);

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
  /** The cylinder's own height, as a fraction of the canvas's cross-axis size — "about
   *  12% at maximum zoom-out, up to about 85% at day-level zoom" — see
   *  cylinderThicknessFraction below. */
  minCylinderThicknessFrac: 0.12,
  maxCylinderThicknessFrac: 0.85,
  /**
   * Highest entry.tier visible per (zoom level, entry kind). 0 means "never at this
   * level, regardless of tier" — governments (cabinets; heads of state are `ruler`, not
   * `government`) never show above decade zoom, for instance, since there is no useful
   * "century of prime ministers" view.
   */
  maxTier: {
    millennium: { period: 1, ruler: 0, government: 0, event: 1 },
    century: { period: 2, ruler: 1, government: 0, event: 1 },
    decade: { period: 3, ruler: 2, government: 1, event: 2 },
    year: { period: 5, ruler: 3, government: 2, event: 3 },
    month: { period: 5, ruler: 4, government: 3, event: 4 },
    day: { period: 5, ruler: 5, government: 5, event: 5 }
  } satisfies Record<ZoomLevel, Record<EntryKind, number>>
} as const;

/* ------------------------------------------------------------------- time representation */

const SLOTS_PER_MONTH = 31;
const SLOTS_PER_YEAR = 12 * SLOTS_PER_MONTH; // 372 — see the module header on why "day" is synthetic

/** A parsed date (from scripts/lib/history.mjs) as a decimal year: 1878.17-ish for
 *  3 March 1878, exactly -450 for the year 450 BC (astronomical numbering, matching the
 *  parser). Year-only dates have no fractional part at all, not an implied "1 January". */
export function decimalYearOfDate(d: Pick<ParsedHistoryDate, 'year' | 'month' | 'day'>): number {
  if (d.month == null) return d.year;
  const slot = (d.month - 1) * SLOTS_PER_MONTH + ((d.day ?? 1) - 1);
  return d.year + slot / SLOTS_PER_YEAR;
}

/** Inverse of decimalYearOfDate. An exact integer round-trips to a year-only date (month
 *  and day both null) — the same convention decimalYearOfDate reads on the way in. */
export function dateOfDecimalYear(t: number): ParsedHistoryDate {
  const year = Math.floor(t);
  const frac = t - year;
  if (frac === 0) return { raw: String(year), year, month: null, day: null };
  const slot = Math.min(Math.max(Math.round(frac * SLOTS_PER_YEAR), 0), SLOTS_PER_YEAR - 1);
  const month = Math.floor(slot / SLOTS_PER_MONTH) + 1;
  const day = (slot % SLOTS_PER_MONTH) + 1;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return { raw: `${year}-${pad2(month)}-${pad2(day)}`, year, month, day };
}

/** Convenience: the authored string straight to a decimal year, for content that hasn't
 *  been parsed yet. `where` is only used in the parser's own error message. */
export function decimalYearOf(raw: string, where = 'decimalYearOf'): number {
  return decimalYearOfDate(parseHistoryDate(raw, where));
}

export { dateKey };

/* --------------------------------------------------------------- viewport and projection */

export interface Viewport {
  /** Decimal year at the centre of the viewport. */
  center: number;
  /** Pixels per year — the only zoom parameter; everything else derives from it. */
  pxPerYear: number;
  /** Size of the viewport along the timeline's axis, in pixels. Works for a horizontal
   *  OR a vertical axis identically: this module never reads a width/height/x/y, only
   *  this one abstract "px along the axis". */
  sizePx: number;
}

export interface TimeRange {
  from: number;
  to: number;
}

export function timeToPx(t: number, viewport: Viewport): number {
  return viewport.sizePx / 2 + (t - viewport.center) * viewport.pxPerYear;
}

export function pxToTime(px: number, viewport: Viewport): number {
  return viewport.center + (px - viewport.sizePx / 2) / viewport.pxPerYear;
}

export function visibleRange(viewport: Viewport): TimeRange {
  return { from: pxToTime(0, viewport), to: pxToTime(viewport.sizePx, viewport) };
}

/** The visible range, widened by `factor` (default CONFIG.overscanFactor) around its own
 *  centre — not the viewport itself, so a viewport panned mid-transition still overscans
 *  symmetrically around what's actually on screen. Used by visibleEntries so entries just
 *  outside the viewport are already culled-in before they scroll into view, instead of
 *  popping in at the edge. */
export function visibleRangeOverscan(viewport: Viewport, factor: number = CONFIG.overscanFactor): TimeRange {
  const { from, to } = visibleRange(viewport);
  const span = to - from;
  const extra = (span * (factor - 1)) / 2;
  return { from: from - extra, to: to + extra };
}

/* ------------------------------------------------------------------------------ zoom ladder */

/** The active granularity for a given zoom. Picks the FINEST level whose threshold is at
 *  or below pxPerYear — see CONFIG.zoomThresholds' own comment. */
export function levelFor(pxPerYear: number): ZoomLevel {
  let level: ZoomLevel = CONFIG.zoomThresholds[0].level;
  for (const { level: candidate, minPxPerYear } of CONFIG.zoomThresholds) {
    if (pxPerYear >= minPxPerYear) level = candidate;
    else break;
  }
  return level;
}

export interface Tick {
  /** Decimal-year position. */
  t: number;
  /** Pixel position in the viewport this was generated for. */
  px: number;
  label: string;
  level: ZoomLevel;
  weight: TickWeight;
}

/** Rounds `span / targetCount` up or down to the nearest "nice" round number — 1, 2 or 5
 *  times a power of ten (the standard tick-count heuristic) — so a step lands on a round
 *  year/decade/century boundary instead of an arbitrary count. Boundaries between the 1/
 *  2/5/10 candidates sit at their geometric means (sqrt(2), sqrt(10), sqrt(50)), so each
 *  candidate wins over the widest possible range of raw steps closest to it. */
function niceStep(span: number, targetCount: number): number {
  const rawStep = span / Math.max(targetCount, 1);
  if (!(rawStep > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const niceResidual = residual < Math.SQRT2 ? 1 : residual < Math.sqrt(10) ? 2 : residual < Math.sqrt(50) ? 5 : 10;
  return niceResidual * magnitude;
}

function integerStepTicks(range: TimeRange, viewport: Viewport, step: number, level: ZoomLevel, weight: TickWeight): Tick[] {
  const out: Tick[] = [];
  const first = Math.ceil(range.from / step) * step;
  for (let t = first; t <= range.to; t += step) {
    out.push({ t, px: timeToPx(t, viewport), label: t < 0 ? `${-t} BC` : String(t), level, weight });
  }
  return out;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Every 1st-of-the-month within range, across however many years the range spans. The
 *  +/-1 year pad only widens the scan, never the output: each candidate is still checked
 *  against `range` before being kept, so it exists purely to catch a tick whose exact
 *  position falls just inside `range` despite its nominal year falling just outside it
 *  (possible only at the range's own boundary, given SLOTS_PER_YEAR's granularity). */
function monthTicks(range: TimeRange, viewport: Viewport, weight: TickWeight): Tick[] {
  const out: Tick[] = [];
  for (let year = Math.floor(range.from) - 1; year <= Math.ceil(range.to) + 1; year++) {
    for (let month = 1; month <= 12; month++) {
      const t = decimalYearOfDate({ year, month, day: 1 });
      if (t < range.from || t > range.to) continue;
      out.push({ t, px: timeToPx(t, viewport), label: MONTH_LABELS[month - 1], level: 'month', weight });
    }
  }
  return out;
}

/** Every synthetic day (1..31 in every month alike — see the module header) within range. */
function dayTicks(range: TimeRange, viewport: Viewport, weight: TickWeight): Tick[] {
  const out: Tick[] = [];
  for (let year = Math.floor(range.from) - 1; year <= Math.ceil(range.to) + 1; year++) {
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= SLOTS_PER_MONTH; day++) {
        const t = decimalYearOfDate({ year, month, day });
        if (t < range.from || t > range.to) continue;
        out.push({ t, px: timeToPx(t, viewport), label: String(day), level: 'day', weight });
      }
    }
  }
  return out;
}

/**
 * Ticks visible in `viewport`, sorted by position. Above year level, exactly one
 * granularity is active (millennium OR century OR decade — never combined). At year
 * level and below, year ticks are always present (weight "major") and month/day layer in
 * as the zoom goes finer, each weighted "minor" so the renderer can style the year ticks
 * as the primary scale and month/day as finer subdivisions of it.
 */
export function ticks(viewport: Viewport): Tick[] {
  const level = levelFor(viewport.pxPerYear);
  const range = visibleRange(viewport);
  const span = range.to - range.from;

  if (COARSE_LEVELS.has(level)) {
    const step = Math.max(1, niceStep(span, CONFIG.tickTargetCount));
    return integerStepTicks(range, viewport, step, level, 'major');
  }

  // Year ticks stay whole years (niceStep can propose a sub-year step once the visible
  // span itself drops below CONFIG.tickTargetCount years, e.g. at month/day zoom) — the
  // clamp to 1 there reproduces the old "one tick per year" behaviour exactly where it
  // already made sense, and only thins beyond that at coarser "year"-level zooms.
  const yearStep = Math.max(1, Math.round(niceStep(span, CONFIG.tickTargetCount)));
  const out = integerStepTicks(range, viewport, yearStep, 'year', 'major');
  if (level === 'month' || level === 'day') out.push(...monthTicks(range, viewport, 'minor'));
  if (level === 'day') out.push(...dayTicks(range, viewport, 'minor'));
  return out.sort((a, b) => a.t - b.t);
}

/* ------------------------------------------------------------------------------ pan/zoom clamp */

/** Clamps pxPerYear so the viewport can never zoom out further than `range` (the data's
 *  own span, plus the caller's margin) fitting the whole viewport width, and never zoom in
 *  past CONFIG.maxPxPerYear — "must not be possible to pan into 12,000 BC or the year
 *  3000", "maximum zoom-in stops at day level". Takes primitives, not a Viewport, so a
 *  caller can clamp pxPerYear BEFORE computing a gesture's new center from it (see
 *  clampCenter below — order matters for "hold the point under the cursor fixed"). */
export function clampPxPerYear(pxPerYear: number, sizePx: number, range: TimeRange): number {
  const span = range.to - range.from;
  const minByRange = sizePx > 0 && span > 0 ? sizePx / span : pxPerYear;
  return Math.min(Math.max(pxPerYear, minByRange), CONFIG.maxPxPerYear);
}

/** Clamps `center` so the visible range never extends past `range`. When the viewport
 *  itself is wider than `range` (fully zoomed out to or past the whole dataset), centers
 *  on `range` instead of letting either edge float arbitrarily. */
export function clampCenter(center: number, pxPerYear: number, sizePx: number, range: TimeRange): number {
  const visibleSpan = pxPerYear > 0 ? sizePx / pxPerYear : Infinity;
  const span = range.to - range.from;
  if (visibleSpan >= span) return (range.from + range.to) / 2;
  const half = visibleSpan / 2;
  return Math.min(Math.max(center, range.from + half), range.to - half);
}

/**
 * How much of the canvas's cross-axis the cylinder occupies, as a fraction, given the
 * current zoom (`pxPerYear`) and the zoom range it can ever take (`minPxPerYear` —
 * whatever currently fills the viewport with the whole content range, so this varies with
 * window size — to `CONFIG.maxPxPerYear`, the fixed day-level ceiling). Interpolates on a
 * LOG scale (zoom is multiplicative, not additive — the century-to-decade jump and the
 * month-to-day jump should feel like comparable "amounts of zoom") between
 * `minCylinderThicknessFrac` and `maxCylinderThicknessFrac`, smoothstep-eased so the curve
 * itself has no kink — the caller (HistoryTimeline) is what turns this into a
 * frame-to-frame animation; this function alone is a pure snapshot for a given pxPerYear.
 */
export function cylinderThicknessFraction(pxPerYear: number, minPxPerYear: number, maxPxPerYear: number): number {
  const { minCylinderThicknessFrac: minFrac, maxCylinderThicknessFrac: maxFrac } = CONFIG;
  if (!(maxPxPerYear > minPxPerYear)) return minFrac;
  const lo = Math.log(Math.max(minPxPerYear, 1e-6));
  const hi = Math.log(Math.max(maxPxPerYear, minPxPerYear * 1.0001));
  const x = Math.log(Math.min(Math.max(pxPerYear, minPxPerYear), maxPxPerYear));
  const t = (x - lo) / (hi - lo);
  const eased = t * t * (3 - 2 * t); // smoothstep
  return minFrac + eased * (maxFrac - minFrac);
}

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
 * on why that order is fixed rather than incidental.
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
