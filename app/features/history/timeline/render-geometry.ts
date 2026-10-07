/**
 * Axis projection, zoom-level thresholds, visibility and text-fitting helpers of the history renderer.
 */
import { type Axis } from './render-types';
import { COLORS, ROW_HEIGHT_BY_KIND } from './render-colors';
import { smoothstep } from './render-easing';
import { type LabelCandidate } from './layout';
import { CONFIG, visibleRangeOverscan, ZOOM_LEVELS, type EntryKind, type Tick, type Viewport, type ZoomLevel } from './scale';

/** A ZoomLevel's own pxPerYear threshold, read off CONFIG.zoomThresholds — the one place
 *  this module borrows the zoom ladder's own anchors instead of hardcoding a duplicate
 *  number, for eventTierReveal below. */
function pxPerYearThresholdFor(level: ZoomLevel): number {
  return CONFIG.zoomThresholds.find(t => t.level === level)?.minPxPerYear ?? 0;
}

/** Every lane's own row height — a fixed constant per kind (ROW_HEIGHT_BY_KIND), the same
 *  at every zoom level and independent of the cylinder's own size. */
export function rowHeightFor(kind: EntryKind): number {
  return ROW_HEIGHT_BY_KIND[kind];
}

/** The coarsest ZoomLevel at which `tier` first becomes fully visible, per
 *  CONFIG.maxTier's `event` column (scale.ts) — the only column the render path still
 *  consults for events. */
function unlockLevelForTier(tier: number): ZoomLevel {
  for (const level of ZOOM_LEVELS) {
    if (CONFIG.maxTier[level].event >= tier) return level;
  }
  return ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
}

/**
 * How visible an event pin of `tier` is at `pxPerYear`, in [0, 1] — "event pins are
 * filtered by tier... lower tiers fade in over the zoom band before their level, so pins
 * never pop." 1 once the tier's own unlock level (unlockLevelForTier) is reached; 0 for
 * the whole zoom range before the PRECEDING level (so a tier that unlocks at decade zoom
 * is fully absent through all of millennium and the start of century); log-interpolated
 * smoothly across that one preceding level's own zoom band in between. A tier that already
 * unlocks at the coarsest level (millennium — tier 1) is always fully visible.
 */
export function eventTierReveal(tier: number, pxPerYear: number): number {
  const unlockLevel = unlockLevelForTier(tier);
  const unlockIdx = ZOOM_LEVELS.indexOf(unlockLevel);
  if (unlockIdx <= 0) return 1;
  const hi = pxPerYearThresholdFor(unlockLevel);
  const lo = pxPerYearThresholdFor(ZOOM_LEVELS[unlockIdx - 1]);
  if (pxPerYear >= hi) return 1;
  if (pxPerYear <= lo || !(hi > lo)) return 0;
  const t = (Math.log(pxPerYear) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
  return smoothstep(t);
}

/** Range-only visibility (overscanned viewport, no tier check) — period/ruler/government
 *  are always drawn regardless of zoom or tier (see the module header and CONFIG.maxTier's
 *  own doc); events use it too, then fade per-tier at draw time (eventTierReveal) rather
 *  than being culled outright. Replaces scale.ts's tier-aware visibleEntries for the
 *  render path specifically. */
export function rangeVisible<T extends { start: number; end: number | null }>(entries: readonly T[], viewport: Viewport): T[] {
  const { from, to } = visibleRangeOverscan(viewport);
  return entries.filter(e => (e.end ?? Infinity) >= from && e.start <= to);
}

/** The one place axis direction is decided: (along-axis px, cross-axis px) -> real
 *  canvas (x, y). "along" is time; "cross" is everything perpendicular to it. */
export function project(axis: Axis, along: number, cross: number): { x: number; y: number } {
  return axis === 'horizontal' ? { x: along, y: cross } : { x: cross, y: along };
}

/** Two along/cross corners -> a normalised {x, y, w, h} rectangle, in either axis. */
export function rectFor(axis: Axis, along0: number, along1: number, cross0: number, cross1: number) {
  const p0 = project(axis, along0, cross0);
  const p1 = project(axis, along1, cross1);
  return { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) };
}

/** Text at an (along, cross) position, with a dark halo stroke for legibility over
 *  whatever's underneath (same technique as app/engines/map/renderer.ts's drawLabels). Caller
 *  sets font/textAlign/textBaseline first; those are orientation-independent. On the
 *  vertical axis the text is rotated 90° so it still reads along the timeline rather than
 *  across it. */
export function drawHaloText(ctx: CanvasRenderingContext2D, axis: Axis, along: number, cross: number, text: string, fill: string): void {
  const p = project(axis, along, cross);
  ctx.save();
  ctx.translate(p.x, p.y);
  if (axis === 'vertical') ctx.rotate(Math.PI / 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.labelHalo;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** Shortens `text` with a trailing ellipsis until it fits `maxWidthPx` (the font must
 *  already be set on `ctx`), or '' if even a bare ellipsis doesn't fit — the caller's cue
 *  to skip the label but keep the capsule. */
export function truncateToFit(ctx: CanvasRenderingContext2D, text: string, maxWidthPx: number): string {
  if (maxWidthPx <= 0) return '';
  if (ctx.measureText(text).width <= maxWidthPx) return text;
  const ellipsis = '…';
  if (ctx.measureText(ellipsis).width > maxWidthPx) return '';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidthPx) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '' : text.slice(0, lo) + ellipsis;
}

export function labelCandidate(id: string, anchorPx: number, widthPx: number, align: 'left' | 'center', tier: number, padPx = 0): LabelCandidate {
  const left = align === 'center' ? anchorPx - widthPx / 2 - padPx : anchorPx - padPx;
  return { id, px: left, widthPx: widthPx + padPx * 2, tier };
}

/** Drops ticks whose px position is closer than `minGapPx` to a kept tick's — applies to
 *  the MARK itself, not just its label (placeLabels, below, separately thins the text). */
export function declutterByPx(candidates: readonly Tick[], minGapPx: number): Tick[] {
  const sorted = [...candidates].sort((a, b) => a.px - b.px);
  const kept: Tick[] = [];
  let lastPx = -Infinity;
  for (const tick of sorted) {
    if (tick.px - lastPx >= minGapPx) {
      kept.push(tick);
      lastPx = tick.px;
    }
  }
  return kept;
}
