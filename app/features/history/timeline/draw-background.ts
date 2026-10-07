/**
 * The cylinder background and the out-of-range fade.
 */
import { type Axis } from './render-types';
import { COLORS, RENDER_CONFIG } from './render-colors';
import { project, rectFor, drawHaloText } from './render-geometry';
import { dateOfDecimalYear, timeToPx, type TimeRange, type Viewport } from './scale';

/* ------------------------------------------------------------------------- the background */

/**
 * The page's whole background: a flat vertical gradient (COLORS.bgTop to COLORS.bgBottom)
 * across the canvas's real screen height — independent of the timeline axis, since it's a
 * page backdrop, not a time-axis element. Replaces the old lit-drum cylinder shell
 * entirely: no per-band gradient, highlight or vignette any more — each wire now draws its
 * own flat lane track instead (see drawLaneTrack).
 */
export function drawBackground(ctx: CanvasRenderingContext2D, full: { x: number; y: number; w: number; h: number }, canvasHeightPx: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeightPx);
  gradient.addColorStop(0, COLORS.bgTop);
  gradient.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(full.x, full.y, full.w, full.h);
}

/**
 * Darkens the cylinder outside the dataset's own [contentRange.from, contentRange.to] —
 * "fade the cylinder's brightness towards both outer regions" — and, where enough of that
 * empty zone is on screen to read comfortably, a muted label: <pastLabel> ("{year}" = the earliest
 * year) to the left, <futureLabel> to the right (both per country, countries.ts). Both zones are always
 * reachable (never fully off the pannable range) since HistoryTimeline's pan limit is
 * exactly half a viewport past each edge at maximum zoom-out.
 */
export function drawOutOfRangeFade(
  ctx: CanvasRenderingContext2D, axis: Axis, monoFont: string, viewport: Viewport,
  cylinderTop: number, cylinderBottom: number, contentRange: TimeRange, pastLabel: string, futureLabel: string
): void {
  const startPx = timeToPx(contentRange.from, viewport);
  const endPx = timeToPx(contentRange.to, viewport);
  const midCross = (cylinderTop + cylinderBottom) / 2;

  const fade = (fromPx: number, toPx: number): void => {
    if (toPx - fromPx < 1) return;
    const g0 = project(axis, toPx, 0);
    const g1 = project(axis, fromPx, 0);
    const grad = ctx.createLinearGradient(g0.x, g0.y, g1.x, g1.y);
    grad.addColorStop(0, 'rgba(8,13,19,0)');
    grad.addColorStop(1, 'rgba(8,13,19,.6)');
    ctx.fillStyle = grad;
    const r = rectFor(axis, fromPx, toPx, cylinderTop, cylinderBottom);
    ctx.fillRect(r.x, r.y, r.w, r.h);
  };

  if (startPx > 0) {
    const edge = Math.min(startPx, viewport.sizePx);
    fade(0, edge);
    if (edge > 70) {
      const earliestYear = dateOfDecimalYear(contentRange.from).year;
      ctx.font = `600 ${RENDER_CONFIG.fadeZoneLabelFontPx}px ${monoFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      drawHaloText(ctx, axis, edge / 2, midCross, pastLabel.replace('{year}', String(earliestYear)), COLORS.ink3);
    }
  }
  if (endPx < viewport.sizePx) {
    const edge = Math.max(endPx, 0);
    fade(edge, viewport.sizePx);
    if (viewport.sizePx - edge > 70) {
      ctx.font = `600 ${RENDER_CONFIG.fadeZoneLabelFontPx}px ${monoFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      drawHaloText(ctx, axis, (edge + viewport.sizePx) / 2, midCross, futureLabel, COLORS.ink3);
    }
  }
}
