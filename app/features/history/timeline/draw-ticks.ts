/**
 * The date ticks along the top of the cylinder.
 */
import { type Axis } from './render-types';
import { COLORS, RENDER_CONFIG } from './render-colors';
import { project, drawHaloText, labelCandidate, declutterByPx } from './render-geometry';
import { placeLabels, type LabelCandidate } from './layout';
import { ticks, type Viewport } from './scale';

/* ------------------------------------------------------------------------------- ticks */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function formatHistoryDate(d: { year: number; month: number | null; day: number | null }): string {
  const yearLabel = d.year < 0 ? `${-d.year} BC` : String(d.year);
  if (d.month == null) return yearLabel;
  return `${d.day} ${MONTH_NAMES[d.month - 1]} ${yearLabel}`;
}

/** Ticks and their labels, drawn on the cylinder's own top surface, inside
 *  RENDER_CONFIG.tickStripHeight — "year labels stay on the cylinder's top surface." */
export function drawTopTicks(ctx: CanvasRenderingContext2D, axis: Axis, monoFont: string, viewport: Viewport, cylinderTop: number): void {
  const { tickMajorLength, tickMinorLength } = RENDER_CONFIG;
  const all = ticks(viewport);
  const majors = all.filter(t => t.weight === 'major');
  const minors = declutterByPx(all.filter(t => t.weight === 'minor'), 4);
  const drawn = [...majors, ...minors].sort((a, b) => a.t - b.t);

  const markTop = cylinderTop + 4;
  for (const tick of drawn) {
    const length = tick.weight === 'major' ? tickMajorLength : tickMinorLength;
    const p0 = project(axis, tick.px, markTop);
    const p1 = project(axis, tick.px, markTop + length);
    ctx.strokeStyle = tick.weight === 'major' ? 'rgba(230,238,243,.6)' : 'rgba(103,128,143,.25)';
    ctx.lineWidth = tick.weight === 'major' ? 1.3 : 1;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  const labelCross = markTop + tickMajorLength + 2;
  const candidates: LabelCandidate[] = drawn.map((tick, i) => {
    ctx.font = `${tick.weight === 'major' ? 600 : 400} 10px ${monoFont}`;
    return labelCandidate(String(i), tick.px, ctx.measureText(tick.label).width, 'center', tick.weight === 'major' ? 0 : 1, 3);
  });
  const placed = new Set(placeLabels(candidates).map(c => c.id));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  drawn.forEach((tick, i) => {
    if (!placed.has(String(i))) return;
    ctx.font = `${tick.weight === 'major' ? 600 : 400} 10px ${monoFont}`;
    drawHaloText(ctx, axis, tick.px, labelCross, tick.label, tick.weight === 'major' ? COLORS.ink2 : COLORS.ink3);
  });
}
