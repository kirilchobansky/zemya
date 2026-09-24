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
 *
 * Every label on this page — ticks, bars, pins, the context stack — goes through
 * placeLabels() (layout.ts), grouped by whatever visually shares a line (a lane row, or
 * the tick strip), so a crowded zoom drops the lower-tier text instead of overlapping it.
 * Text is Bulgarian (entry.label is name.bg — see catalog.server.ts): both canvas fonts
 * are read from CSS custom properties that resolve to Archivo/IBM Plex Mono, which carry
 * Cyrillic; app/lib/history/timeline.ts additionally waits on `document.fonts.ready`
 * before trusting the font read at mount, so a frame drawn before the webfont finishes
 * loading gets corrected rather than staying stuck on a Latin-only fallback.
 */
import { assignRows, classifySpan, contextAt, placeLabels, type LabelCandidate, type LayoutEntry } from './layout';
import { dateOfDecimalYear, pxToTime, ticks, timeToPx, visibleEntries, type EntryKind, type Viewport } from './scale';

export type Axis = 'horizontal' | 'vertical';

/** A layout entry plus the one extra thing rendering needs that pure logic doesn't
 *  carry: display text. Kept separate from LayoutEntry on purpose — scale.ts/layout.ts
 *  stay ignorant of names, same as they're ignorant of YAML or JSON. Bulgarian (name.bg),
 *  not English — see catalog.server.ts. */
export interface TimelineEntry extends LayoutEntry {
  label: string;
}

const COLORS = {
  abyss: '#080D13', // --abyss
  chart: '#0E1720', // --chart
  land: '#31485A', // --land — periods
  rule: '#243543', // --rule — period stroke
  ink: '#E6EEF3', // --ink — bar text, the context stack's period line
  ink2: '#9FB3C0', // --ink-2
  ink3: '#67808F', // --ink-3 — the context stack's government line (no bars of its own)
  brass: '#E8A33D', // --brass — event pins, the centre marker
  brass2: '#F5CE86', // --brass-2 — pinned/event label text
  brassDim: '#8A6425', // --brass-dim — event stems
  sea: '#4EA9C9', // --sea — rulers, the context stack's ruler line
  seaDim: '#2A5F75', // --sea-dim — ruler fill
  highlight: 'rgba(245,206,134,.35)', // --brass-2, low opacity — the cylinder's specular line
  labelHalo: 'rgba(8,13,19,.85)', // --abyss, high opacity
  pinnedHalo: 'rgba(8,13,19,.72)'
} as const;

export const RENDER_CONFIG = {
  contextStackTop: 8,
  contextStackLineGap: 4,
  cylinderTop: 72,
  cylinderThickness: 88,
  tickMajorLength: 88, // spans the cylinder's full thickness
  tickMinorLength: 44,
  tickLabelGap: 10,
  /** Where an event pin's dot sits, and how far its stem drops before the label. */
  eventDotCross: 194,
  eventStemLength: 16,
  /** Where the period lane starts — under the cylinder, its tick labels and the event row. */
  rowsTop: 236,
  /** Periods and rulers get different row heights as well as different colours — "a
   *  glance should tell them apart without a legend" applies to shape, not just hue. */
  periodRowHeight: 32,
  rulerRowHeight: 24,
  rowGap: 6,
  /** Gap between the period lane and the ruler lane below it. */
  laneGap: 18,
  /** Inset so two adjacent bars never visually touch. */
  barPadPx: 2
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

/** Shortens `text` with a trailing ellipsis until it fits `maxWidthPx` (the font must
 *  already be set on `ctx`), or '' if even a bare ellipsis doesn't fit — "hidden entirely
 *  when there is no room at all", the caller's cue to skip the label but keep the bar. */
function truncateToFit(ctx: CanvasRenderingContext2D, text: string, maxWidthPx: number): string {
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

/** Converts a text's rendering anchor + measured width into placeLabels' left-edge/width
 *  convention (layout.ts's overlap test assumes `px` is the LEFT edge), so the collision
 *  check matches what's actually going to be on screen regardless of whether the text is
 *  left- or centre-aligned. `padPx` widens the box a little on each side so two labels
 *  get a hair of breathing room rather than touching pixel-to-pixel. */
function labelCandidate(id: string, anchorPx: number, widthPx: number, align: 'left' | 'center', tier: number, padPx = 0): LabelCandidate {
  const left = align === 'center' ? anchorPx - widthPx / 2 - padPx : anchorPx - padPx;
  return { id, px: left, widthPx: widthPx + padPx * 2, tier };
}

/** classifySpan's `labelPx` (and an event's raw time position) are clamped to keep that
 *  one ANCHOR point on screen — they don't and can't know the text's rendered width
 *  (layout.ts stays font-metric-agnostic on purpose). Centred text at an anchor clamped
 *  right at the edge would still have half of itself rendered off-canvas, so the
 *  renderer clamps a second time here, accounting for the actual measured width, before
 *  handing the position to placeLabels or drawHaloText. */
function clampCentredAnchor(anchorPx: number, widthPx: number, sizePx: number, padPx: number): number {
  const half = widthPx / 2 + padPx;
  if (half * 2 >= sizePx) return sizePx / 2; // wider than the viewport itself — centre it and let it clip
  return Math.min(Math.max(anchorPx, half), sizePx - half);
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
 *  into an unreadable smear. placeLabels resolves it: major beats minor on overlap, and
 *  a dropped label still leaves its mark on the surface. */
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
    return labelCandidate(String(i), tick.px, ctx.measureText(tick.label).width, 'center', tick.weight === 'major' ? 0 : 1, 4);
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

/* -------------------------------------------------------------------------- context stack */

/**
 * Above the cylinder: what contains the date under the centre marker, one line per kind
 * — period (largest, top), ruler, government (smallest) — each in its own colour so the
 * three read as a hierarchy, not a list. A kind with no containing entry (a gap — no
 * ruler during most of Ottoman rule, no government before 1878) is skipped outright, not
 * drawn as a placeholder. Runs contextAt against the WHOLE dataset, not the zoom-culled
 * subset, so the answer never depends on which bars happen to be drawn right now — "stays
 * readable at every zoom level" means correct at every zoom level too.
 */
function drawContextStack(ctx: CanvasRenderingContext2D, axis: Axis, uiFont: string, entries: readonly TimelineEntry[], viewport: Viewport): void {
  const at = contextAt(entries, viewport.center);
  const alongCentre = viewport.sizePx / 2;

  const lines: { text: string; fontPx: number; color: string }[] = [];
  if (at.period.primary) lines.push({ text: at.period.primary.label, fontPx: 18, color: COLORS.ink });
  if (at.ruler.primary) lines.push({ text: at.ruler.primary.label, fontPx: 15, color: COLORS.sea });
  if (at.government.primary) lines.push({ text: at.government.primary.label, fontPx: 13, color: COLORS.ink3 });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let cross = RENDER_CONFIG.contextStackTop;
  for (const line of lines) {
    ctx.font = `700 ${line.fontPx}px ${uiFont}`;
    drawHaloText(ctx, axis, alongCentre, cross, line.text, line.color);
    cross += line.fontPx + RENDER_CONFIG.contextStackLineGap;
  }
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

/**
 * One kind's entries, one row at a time, as bars (classifySpan's "bar" mode) or a label
 * pinned to stay on screen ("pinned" mode, for a span wider than the viewport) — see
 * layout.ts. Bars always draw; their labels are collision-resolved with placeLabels PER
 * ROW (two labels in different rows never compete — they don't visually overlap — so
 * grouping by row before calling placeLabels matters, not just calling it once per lane).
 * A bar label is truncated to fit its own bar first; a pinned label keeps its full text
 * (it isn't boxed in the way a bar is).
 */
function drawLane(
  ctx: CanvasRenderingContext2D, axis: Axis, uiFont: string,
  entries: readonly TimelineEntry[], rows: ReadonlyMap<string, number>, viewport: Viewport,
  laneTop: number, rowHeight: number, fill: string, stroke: string
): void {
  const { rowGap, barPadPx } = RENDER_CONFIG;
  const visibleFrom = pxToTime(0, viewport);
  const visibleTo = pxToTime(viewport.sizePx, viewport);
  const visibleSpan = Math.max(visibleTo - visibleFrom, 1e-9);

  const byRow = new Map<number, TimelineEntry[]>();
  for (const e of entries) {
    const row = rows.get(e.id) ?? 0;
    (byRow.get(row) ?? byRow.set(row, []).get(row)!).push(e);
  }

  for (const [row, rowEntries] of byRow) {
    const cross0 = laneTop + row * (rowHeight + rowGap);
    const cross1 = cross0 + rowHeight;
    const crossMid = (cross0 + cross1) / 2;
    const spans = new Map(rowEntries.map(e => [e.id, classifySpan(e, viewport)] as const));

    for (const e of rowEntries) {
      const span = spans.get(e.id)!;
      if (span.mode !== 'bar') continue;
      const r = rectFor(axis, span.fromPx + barPadPx, span.toPx - barPadPx, cross0, cross1);
      if (r.w <= 0 || r.h <= 0) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
    }

    interface Candidate { entry: TimelineEntry; text: string; anchorPx: number; align: 'left' | 'center'; widthPx: number; tier: number }
    const candidates: Candidate[] = [];
    for (const e of rowEntries) {
      const span = spans.get(e.id)!;
      if (span.mode === 'bar') {
        const r = rectFor(axis, span.fromPx + barPadPx, span.toPx - barPadPx, cross0, cross1);
        const barAlongPx = (axis === 'horizontal' ? r.w : r.h) - 12; // inset padding, both sides
        if (barAlongPx <= 0) continue;
        ctx.font = `500 12px ${uiFont}`;
        const text = truncateToFit(ctx, e.label, barAlongPx);
        if (!text) continue; // no room even for an ellipsis — bar stays, label doesn't
        candidates.push({ entry: e, text, anchorPx: span.fromPx + barPadPx + 6, align: 'left', widthPx: ctx.measureText(text).width, tier: e.tier });
      } else {
        ctx.font = `600 12px ${uiFont}`;
        const widthPx = ctx.measureText(e.label).width;
        const anchorPx = clampCentredAnchor(span.labelPx, widthPx, viewport.sizePx, 6);
        // Two non-overlapping periods sharing a row (Byzantine rule, then Second Empire)
        // can both be pinned near their shared boundary, with clamped anchors close
        // enough to collide even though their actual date ranges never do. A plain
        // tier/id tie-break would pick whichever wins alphabetically — possibly the one
        // the view barely touches at the edge, hiding the one that covers almost the
        // whole screen. Nudge the tier by how much of the VISIBLE range this entry's own
        // span covers, so among equal-tier pinned rivals, "what you're mostly looking
        // at" wins — never enough to cross into a genuinely different content tier.
        const overlapStart = Math.max(e.start, visibleFrom);
        const overlapEnd = Math.min(e.end ?? Infinity, visibleTo);
        const overlapFraction = Math.max(0, overlapEnd - overlapStart) / visibleSpan;
        candidates.push({ entry: e, text: e.label, anchorPx, align: 'center', widthPx, tier: e.tier - overlapFraction * 0.5 });
      }
    }

    const survivors = new Set(
      placeLabels(candidates.map(c => labelCandidate(c.entry.id, c.anchorPx, c.widthPx, c.align, c.tier, 6))).map(c => c.id)
    );

    for (const c of candidates) {
      if (!survivors.has(c.entry.id)) continue;
      if (c.align === 'left') {
        const span = spans.get(c.entry.id)!;
        if (span.mode !== 'bar') continue;
        const r = rectFor(axis, span.fromPx + barPadPx, span.toPx - barPadPx, cross0, cross1);
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        ctx.font = `500 12px ${uiFont}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        drawHaloText(ctx, axis, c.anchorPx, crossMid, c.text, COLORS.ink);
        ctx.restore();
      } else {
        ctx.font = `600 12px ${uiFont}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const halo = rectFor(axis, c.anchorPx - c.widthPx / 2 - 6, c.anchorPx + c.widthPx / 2 + 6, cross0 + 3, cross1 - 3);
        ctx.fillStyle = COLORS.pinnedHalo;
        ctx.fillRect(halo.x, halo.y, halo.w, halo.h);
        drawHaloText(ctx, axis, c.anchorPx, crossMid, c.text, COLORS.brass2);
      }
    }
  }
}

/* ------------------------------------------------------------------------------- events */

/**
 * kind: event entries as pins below the cylinder — a short stem, a dot at
 * `RENDER_CONFIG.eventDotCross`, and a "year — name" label below it. Stems and dots
 * always draw (they're cheap and unambiguous even packed tight); labels are
 * collision-resolved by placeLabels using each event's own tier, same rule as everywhere
 * else on this page.
 */
function drawEvents(ctx: CanvasRenderingContext2D, axis: Axis, uiFont: string, entries: readonly TimelineEntry[], viewport: Viewport): void {
  const { eventDotCross, eventStemLength } = RENDER_CONFIG;
  const labelCross = eventDotCross + eventStemLength;
  const positioned = entries.map(e => ({ entry: e, px: timeToPx(e.start, viewport) }));

  for (const { px } of positioned) {
    const p0 = project(axis, px, eventDotCross);
    const p1 = project(axis, px, labelCross);
    ctx.strokeStyle = COLORS.brassDim;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.fillStyle = COLORS.brass;
    ctx.beginPath();
    ctx.arc(p0.x, p0.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = `600 11px ${uiFont}`;
  // The label's anchor is the dot's position clamped for its own measured width (see
  // clampCentredAnchor) — so a pin near either edge keeps its full label on screen while
  // its stem and dot stay exactly on the true date.
  const withText = positioned.map(({ entry, px }) => {
    const { year } = dateOfDecimalYear(entry.start);
    const text = `${year < 0 ? `${-year} BC` : year} — ${entry.label}`;
    const widthPx = ctx.measureText(text).width;
    return { entry, text, widthPx, labelPx: clampCentredAnchor(px, widthPx, viewport.sizePx, 4) };
  });

  const survivors = new Set(
    placeLabels(withText.map(w => labelCandidate(w.entry.id, w.labelPx, w.widthPx, 'center', w.entry.tier, 4))).map(c => c.id)
  );

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const w of withText) {
    if (!survivors.has(w.entry.id)) continue;
    ctx.font = `600 11px ${uiFont}`;
    drawHaloText(ctx, axis, w.labelPx, labelCross + 4, w.text, COLORS.brass2);
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
 * One frame: background, the cylinder and its ticks, event pins, period bars, ruler
 * bars, the context stack, then the centre marker on top of everything (a fixed overlay,
 * so it must never be drawn under content). `entries` is the WHOLE dataset — row
 * assignment and the context stack both need it complete; this function culls to what's
 * on screen itself, per draw call, via visibleEntries.
 */
export function render(rc: RenderContext, entries: readonly TimelineEntry[]): void {
  const { ctx, viewport, axis, crossSizePx, dpr, uiFont, monoFont } = rc;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const full = rectFor(axis, 0, viewport.sizePx, 0, crossSizePx);
  ctx.clearRect(full.x, full.y, full.w, full.h);
  ctx.fillStyle = COLORS.abyss;
  ctx.fillRect(full.x, full.y, full.w, full.h);

  drawCylinder(ctx, axis, viewport.sizePx);
  drawTicks(ctx, axis, monoFont, viewport);

  const visible = visibleEntries(entries, viewport);
  drawEvents(ctx, axis, uiFont, visible.filter(e => e.kind === 'event'), viewport);

  const rows = assignRows(entries);
  const periodRows = laneRowCount(entries, rows, 'period');
  drawLane(
    ctx, axis, uiFont, visible.filter(e => e.kind === 'period'), rows, viewport,
    RENDER_CONFIG.rowsTop, RENDER_CONFIG.periodRowHeight, COLORS.land, COLORS.rule
  );
  const rulerTop = RENDER_CONFIG.rowsTop + periodRows * (RENDER_CONFIG.periodRowHeight + RENDER_CONFIG.rowGap) + RENDER_CONFIG.laneGap;
  drawLane(
    ctx, axis, uiFont, visible.filter(e => e.kind === 'ruler'), rows, viewport,
    rulerTop, RENDER_CONFIG.rulerRowHeight, COLORS.seaDim, COLORS.sea
  );

  drawContextStack(ctx, axis, uiFont, entries, viewport);
  drawCentreMarker(ctx, axis, monoFont, viewport, crossSizePx);
}
