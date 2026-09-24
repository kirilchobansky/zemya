/**
 * Canvas renderer for the history timeline. Pure draw functions — no React, no DOM
 * beyond the CanvasRenderingContext2D they're handed. Mirrors app/lib/map/renderer.ts's
 * shape (one RenderContext, one entry-point `render()`, a literal COLORS object) but for
 * the 1D time axis instead of the 2D Mercator world.
 *
 * Every function takes `axis` and goes through `project()`/`rectFor()`/`drawHaloText()`
 * to turn an (along-axis, cross-axis) position into real canvas x/y — nothing below ever
 * writes `ctx.something(x, y)` with x or y read directly off a Viewport or a screen
 * event. Only "horizontal" is driven by a route today (app/routes/history.bulgaria.tsx);
 * "vertical" exists so a later globe-timeline or sidebar layout costs a parameter, not a
 * rewrite.
 *
 * Colors are literals, not CSS custom properties — canvas can't read a custom property
 * cheaply every frame, same reasoning as app/lib/map/renderer.ts's COLORS. Keep these in
 * sync with app/styles/tokens.css by hand (see that file's own "change one, change both").
 */
import { assignRows, classifySpan, placeLabels, type LabelCandidate, type LayoutEntry } from './layout';
import { dateOfDecimalYear, ticks, visibleEntries, type EntryKind, type Viewport } from './scale';

export type Axis = 'horizontal' | 'vertical';

/** A layout entry plus the one extra thing rendering needs that pure logic doesn't
 *  carry: display text. Kept separate from LayoutEntry on purpose — scale.ts/layout.ts
 *  stay ignorant of names, same as they're ignorant of YAML or JSON. */
export interface TimelineEntry extends LayoutEntry {
  label: string;
}

const COLORS = {
  abyss: '#080D13', // --abyss
  chart: '#0E1720', // --chart
  land: '#31485A', // --land
  rule: '#243543', // --rule
  ink: '#E6EEF3', // --ink
  ink2: '#9FB3C0', // --ink-2
  ink3: '#67808F', // --ink-3
  brass: '#E8A33D', // --brass
  brass2: '#F5CE86', // --brass-2
  sea: '#4EA9C9', // --sea
  seaDim: '#2A5F75', // --sea-dim
  highlight: 'rgba(245,206,134,.35)', // --brass-2, low opacity — the cylinder's specular line
  labelHalo: 'rgba(8,13,19,.85)', // --abyss, high opacity
  pinnedHalo: 'rgba(8,13,19,.72)'
} as const;

export const RENDER_CONFIG = {
  cylinderTop: 28,
  cylinderThickness: 88,
  tickMajorLength: 88, // spans the cylinder's full thickness
  tickMinorLength: 44,
  tickLabelGap: 10,
  rowHeight: 30,
  rowGap: 6,
  /** Where the period lane starts — under the cylinder and its tick labels. */
  rowsTop: 150,
  /** Gap between the period lane and the ruler lane below it. */
  laneGap: 18,
  /** Inset so two adjacent bars never visually touch. */
  barPadPx: 2,
  /** A bar narrower than this draws with no inline label — there's no room to read it. */
  minLabelBarPx: 28
} as const;

/** The one place axis direction is decided: (along-axis px, cross-axis px) -> real
 *  canvas (x, y). "along" is time; "cross" is everything perpendicular to it. */
function project(axis: Axis, along: number, cross: number): { x: number; y: number } {
  return axis === 'horizontal' ? { x: along, y: cross } : { x: cross, y: along };
}

/** Two along/cross corners -> a normalised {x, y, w, h} rectangle, in either axis. */
function rectFor(axis: Axis, along0: number, along1: number, cross0: number, cross1: number) {
  const p0 = project(axis, along0, cross0);
  const p1 = project(axis, along1, cross1);
  return { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) };
}

/** Text at an (along, cross) position, with a dark halo stroke for legibility over
 *  whatever's underneath (same technique as app/lib/map/renderer.ts's drawLabels). Caller
 *  sets font/textAlign/textBaseline first; those are orientation-independent. On the
 *  vertical axis the text is rotated 90° so it still reads along the timeline rather than
 *  across it. */
function drawHaloText(ctx: CanvasRenderingContext2D, axis: Axis, along: number, cross: number, text: string, fill: string): void {
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

/* -------------------------------------------------------------------------- the cylinder */

/**
 * A band across the canvas with a dark-bright-dark gradient across its THICKNESS (not
 * along the timeline) so it reads as lit from above, like a rotating drum — plus a thin
 * highlight line near the top, the specular hint that sells the roundness.
 */
function drawCylinder(ctx: CanvasRenderingContext2D, axis: Axis, alongSizePx: number): void {
  const { cylinderTop: top, cylinderThickness: thickness } = RENDER_CONFIG;
  const p0 = project(axis, 0, top);
  const p1 = project(axis, 0, top + thickness);
  const gradient = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
  gradient.addColorStop(0, COLORS.chart);
  gradient.addColorStop(0.5, COLORS.land);
  gradient.addColorStop(1, COLORS.chart);
  ctx.fillStyle = gradient;
  const band = rectFor(axis, 0, alongSizePx, top, top + thickness);
  ctx.fillRect(band.x, band.y, band.w, band.h);

  const highlightCross = top + thickness * 0.32; // a light source from above, not dead centre
  const h0 = project(axis, 0, highlightCross);
  const h1 = project(axis, alongSizePx, highlightCross);
  ctx.strokeStyle = COLORS.highlight;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(h0.x, h0.y);
  ctx.lineTo(h1.x, h1.y);
  ctx.stroke();
}

/* ------------------------------------------------------------------------------- ticks */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function formatHistoryDate(d: { year: number; month: number | null; day: number | null }): string {
  const yearLabel = d.year < 0 ? `${-d.year} BC` : String(d.year);
  if (d.month == null) return yearLabel;
  return `${d.day} ${MONTH_NAMES[d.month - 1]} ${yearLabel}`;
}

/** Tick marks and labels, drawn ON the cylinder's surface — major ticks span its full
 *  thickness, minor ticks (month/day, only active at finer zoom — see scale.ts's ticks())
 *  span half of it, so the two weights stay visually distinct without a third colour.
 *
 *  Marks and labels are two separate passes: every tick gets its mark, but at a zoom
 *  where consecutive year ticks are closer together than their labels are wide (a
 *  border case around the year/decade threshold), printing every label would overlap
 *  into an unreadable smear. placeLabels (layout.ts) — built for exactly this, for
 *  entries — resolves it the same way here: major beats minor on overlap, and a
 *  dropped label still leaves its mark on the surface. */
function drawTicks(ctx: CanvasRenderingContext2D, axis: Axis, monoFont: string, viewport: Viewport): void {
  const { cylinderTop: top, cylinderThickness: thickness, tickMajorLength, tickMinorLength, tickLabelGap } = RENDER_CONFIG;
  const all = ticks(viewport);

  for (const tick of all) {
    const length = tick.weight === 'major' ? tickMajorLength : tickMinorLength;
    const cross0 = top + (thickness - length) / 2;
    const cross1 = cross0 + length;
    const p0 = project(axis, tick.px, cross0);
    const p1 = project(axis, tick.px, cross1);
    ctx.strokeStyle = tick.weight === 'major' ? 'rgba(230,238,243,.55)' : 'rgba(103,128,143,.45)';
    ctx.lineWidth = tick.weight === 'major' ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  const candidates: LabelCandidate[] = all.map((tick, i) => {
    ctx.font = `${tick.weight === 'major' ? 600 : 400} 11px ${monoFont}`;
    return { id: String(i), px: tick.px, widthPx: ctx.measureText(tick.label).width + 8, tier: tick.weight === 'major' ? 0 : 1 };
  });
  const placed = new Set(placeLabels(candidates).map(c => c.id));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  all.forEach((tick, i) => {
    if (!placed.has(String(i))) return;
    ctx.font = `${tick.weight === 'major' ? 600 : 400} 11px ${monoFont}`;
    drawHaloText(ctx, axis, tick.px, top + thickness + tickLabelGap, tick.label, tick.weight === 'major' ? COLORS.ink2 : COLORS.ink3);
  });
}

/* ------------------------------------------------------------------------ centre marker */

/** A line fixed at the screen centre — never moves as content pans, since it's drawn at
 *  sizePx / 2 rather than at any entry's or tick's computed position — with the exact
 *  date under it. timeToPx(viewport.center, viewport) is always sizePx / 2 by
 *  construction, so reading the date straight off viewport.center is exact. */
function drawCentreMarker(ctx: CanvasRenderingContext2D, axis: Axis, monoFont: string, viewport: Viewport, crossSizePx: number): void {
  const alongCentre = viewport.sizePx / 2;
  const p0 = project(axis, alongCentre, 0);
  const p1 = project(axis, alongCentre, crossSizePx);
  ctx.strokeStyle = COLORS.brass;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();

  ctx.font = `700 13px ${monoFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  drawHaloText(ctx, axis, alongCentre, crossSizePx - 8, formatHistoryDate(dateOfDecimalYear(viewport.center)), COLORS.brass2);
}

/* ------------------------------------------------------------------------- period/ruler lanes */

/** How many rows `kind` occupies, from a row assignment computed over the WHOLE dataset
 *  (see assignRows) — used to place the ruler lane below however tall the period lane
 *  turns out to be, without that offset jumping as entries scroll in and out of view. */
function laneRowCount(entries: readonly LayoutEntry[], rows: ReadonlyMap<string, number>, kind: EntryKind): number {
  let max = -1;
  for (const e of entries) {
    if (e.kind !== kind) continue;
    const row = rows.get(e.id);
    if (row !== undefined && row > max) max = row;
  }
  return max + 1;
}

/** One kind's entries as bars (classifySpan's "bar" mode) or, for a span wider than the
 *  viewport, a label pinned to stay on screen ("pinned" mode) — see layout.ts. */
function drawLane(
  ctx: CanvasRenderingContext2D, axis: Axis, uiFont: string,
  entries: readonly TimelineEntry[], rows: ReadonlyMap<string, number>, viewport: Viewport,
  laneTop: number, fill: string, stroke: string
): void {
  const { rowHeight, rowGap, barPadPx, minLabelBarPx } = RENDER_CONFIG;

  for (const entry of entries) {
    const row = rows.get(entry.id) ?? 0;
    const cross0 = laneTop + row * (rowHeight + rowGap);
    const cross1 = cross0 + rowHeight;
    const crossMid = (cross0 + cross1) / 2;
    const span = classifySpan(entry, viewport);

    if (span.mode === 'bar') {
      const r = rectFor(axis, span.fromPx + barPadPx, span.toPx - barPadPx, cross0, cross1);
      if (r.w <= 0 || r.h <= 0) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));

      const barAlongPx = axis === 'horizontal' ? r.w : r.h;
      if (barAlongPx < minLabelBarPx) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.font = `500 12px ${uiFont}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      drawHaloText(ctx, axis, span.fromPx + barPadPx + 6, crossMid, entry.label, COLORS.ink);
      ctx.restore();
    } else {
      ctx.font = `600 12px ${uiFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const width = ctx.measureText(entry.label).width;
      const halo = rectFor(axis, span.labelPx - width / 2 - 6, span.labelPx + width / 2 + 6, cross0 + 3, cross1 - 3);
      ctx.fillStyle = COLORS.pinnedHalo;
      ctx.fillRect(halo.x, halo.y, halo.w, halo.h);
      drawHaloText(ctx, axis, span.labelPx, crossMid, entry.label, COLORS.brass2);
    }
  }
}

/* -------------------------------------------------------------------------------- entry point */

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  viewport: Viewport;
  axis: Axis;
  /** The canvas's extent perpendicular to the timeline — height when horizontal, width
   *  when vertical. Not part of Viewport, which is deliberately just the time axis. */
  crossSizePx: number;
  dpr: number;
  uiFont: string;
  monoFont: string;
}

/**
 * One frame: background, the cylinder, period bars, ruler bars, ticks, then the centre
 * marker on top of everything (a fixed overlay, so it must never be drawn under content).
 * `entries` is the WHOLE dataset — row assignment needs it complete (see laneRowCount);
 * this function culls to what's on screen itself via visibleEntries.
 */
export function render(rc: RenderContext, entries: readonly TimelineEntry[]): void {
  const { ctx, viewport, axis, crossSizePx, dpr, uiFont, monoFont } = rc;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const full = rectFor(axis, 0, viewport.sizePx, 0, crossSizePx);
  ctx.clearRect(full.x, full.y, full.w, full.h);
  ctx.fillStyle = COLORS.abyss;
  ctx.fillRect(full.x, full.y, full.w, full.h);

  drawCylinder(ctx, axis, viewport.sizePx);

  const rows = assignRows(entries);
  const visible = visibleEntries(entries, viewport);
  const periodRows = laneRowCount(entries, rows, 'period');

  drawLane(ctx, axis, uiFont, visible.filter(e => e.kind === 'period'), rows, viewport, RENDER_CONFIG.rowsTop, COLORS.land, COLORS.rule);
  const rulerTop = RENDER_CONFIG.rowsTop + periodRows * (RENDER_CONFIG.rowHeight + RENDER_CONFIG.rowGap) + RENDER_CONFIG.laneGap;
  drawLane(ctx, axis, uiFont, visible.filter(e => e.kind === 'ruler'), rows, viewport, rulerTop, COLORS.seaDim, COLORS.sea);

  drawTicks(ctx, axis, monoFont, viewport);
  drawCentreMarker(ctx, axis, monoFont, viewport, crossSizePx);
}
