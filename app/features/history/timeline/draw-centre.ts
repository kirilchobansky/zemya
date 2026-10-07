/**
 * The centre marker: the cylinder line and the centre date.
 */
import { type Axis } from './render-types';
import { COLORS, RENDER_CONFIG } from './render-colors';
import { project, drawHaloText } from './render-geometry';
import { formatHistoryDate } from './draw-ticks';
import { dateOfDecimalYear, type Viewport } from './scale';

/* ------------------------------------------------------------------------ centre marker */

/** A faint line confined to the cylinder's own inner height (never outside it — "nothing
 *  outside the cylinder except the centre date readout") marking exactly where the centre
 *  date sits, so it's still legible which capsule the readout above refers to even when
 *  several sit close together. */
export function drawCentreCylinderLine(ctx: CanvasRenderingContext2D, axis: Axis, viewport: Viewport, cylinderTop: number, cylinderBottom: number): void {
  const alongCentre = viewport.sizePx / 2;
  const p0 = project(axis, alongCentre, cylinderTop);
  const p1 = project(axis, alongCentre, cylinderBottom);
  ctx.strokeStyle = COLORS.centreLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
}

/** The one thing allowed outside the cylinder: the exact date under the centre marker,
 *  just above its top edge. timeToPx(viewport.center, viewport) is always sizePx / 2 by
 *  construction, so reading the date straight off viewport.center is exact. */
export function drawCentreDate(ctx: CanvasRenderingContext2D, axis: Axis, monoFont: string, viewport: Viewport, cylinderTop: number): void {
  const alongCentre = viewport.sizePx / 2;
  ctx.font = `700 ${RENDER_CONFIG.centreDateFontPx}px ${monoFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  drawHaloText(
    ctx, axis, alongCentre, cylinderTop - RENDER_CONFIG.centreDateGap,
    formatHistoryDate(dateOfDecimalYear(viewport.center)), COLORS.brass2
  );
}
