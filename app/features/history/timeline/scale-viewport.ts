/** Viewport, projection, zoom ladder and pan/zoom clamping of the timeline's time axis. */
import { CONFIG, type ZoomLevel } from './scale-config';

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
