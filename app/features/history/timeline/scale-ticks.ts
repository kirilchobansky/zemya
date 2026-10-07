/** Axis ticks: one granularity above year level, year plus month/day layers below it. */
import { CONFIG, COARSE_LEVELS, type TickWeight, type ZoomLevel } from './scale-config';
import { decimalYearOfDate, SLOTS_PER_MONTH } from './scale-time';
import { levelFor, timeToPx, visibleRange, type TimeRange, type Viewport } from './scale-viewport';

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
