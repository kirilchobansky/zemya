/**
 * Viewport framing for HistoryTimeline (timeline.ts): the zoom floor, the whole-history
 * fit, and re-clamping after a resize. Pure.
 */
import { clampCenter, clampPxPerYear, type TimeRange, type Viewport } from './scale';
import { DEFAULT_PX_PER_YEAR } from './timeline-config';

/** The zoom floor for THIS frame's sizePx: the cylinder filling the viewport with the
 *  whole content range exactly, no padding — "the cylinder fills the screen" at
 *  maximum zoom-out doubles as the pxPerYear clamp floor. Distinct from
 *  `pannableRange`, which is wider (so 681/today can still be centred once zoomed all
 *  the way out) — see clampPxPerYear's own doc on why the two ranges differ. */
export function minPxPerYear(viewport: Viewport, contentRange: TimeRange): number {
  const span = Math.max(contentRange.to - contentRange.from, 1);
  return viewport.sizePx > 0 ? viewport.sizePx / span : DEFAULT_PX_PER_YEAR;
}

/** The whole-history fit as a flight target: the cylinder filling the viewport edge to
 *  edge with the whole content range (earliest authored entry to today) and nothing more —
 *  the same "no padding" floor clampPxPerYear enforces as the maximum zoom-out. */
export function wholeHistoryTarget(viewport: Viewport, contentRange: TimeRange): { centre: number; pxPerYear: number } {
  const { from, to } = contentRange;
  return { centre: (from + to) / 2, pxPerYear: clampPxPerYear(minPxPerYear(viewport, contentRange), viewport.sizePx, contentRange) };
}

/** Opens the timeline fitted to the whole dataset. Only ever runs once, on the first
 *  resize with a real sizePx (HistoryTimeline's fittedInitialView) — every later resize (a
 *  real window/container size change) must leave the current pan/zoom alone. */
export function fitToWholeHistory(viewport: Viewport, contentRange: TimeRange, pannableRange: TimeRange): Viewport {
  const { centre, pxPerYear } = wholeHistoryTarget(viewport, contentRange);
  return { ...viewport, pxPerYear, center: clampCenter(centre, pxPerYear, viewport.sizePx, pannableRange) };
}

/** A real resize (not the initial fit) can still shrink the viewport below what the
 *  current pxPerYear/center allow — re-clamp so it never ends up panned or zoomed
 *  past the data's own range plus margin. */
export function reclampViewport(viewport: Viewport, contentRange: TimeRange, pannableRange: TimeRange): Viewport {
  const pxPerYear = clampPxPerYear(viewport.pxPerYear, viewport.sizePx, contentRange);
  const center = clampCenter(viewport.center, pxPerYear, viewport.sizePx, pannableRange);
  return { ...viewport, pxPerYear, center };
}
