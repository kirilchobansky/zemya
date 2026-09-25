/**
 * Canvas renderer for the history timeline. Pure draw functions — no React, no DOM
 * beyond the CanvasRenderingContext2D they're handed. Mirrors app/lib/map/renderer.ts's
 * shape (one RenderContext, one entry-point `render()`, a literal COLORS object) but for
 * the 1D time axis instead of the 2D Mercator world.
 *
 * The whole page IS the cylinder: a single full-width band, vertically centred, that
 * grows and shrinks with zoom (HistoryTimeline eases its thickness frame to frame — this
 * module just draws whatever thickness it's handed). Everything except the centre date
 * readout lives INSIDE it: year ticks on its top surface, then horizontal "wires" stacked
 * by duration (periods, rulers, governments, events) with entries drawn as rounded
 * capsules sitting on them.
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
 * sync with app/styles/tokens.css by hand where they correspond (see that file's own
 * "change one, change both") — the per-kind wire colours (sea/gov/brass/land) are new,
 * canvas-only variants with no token equivalent.
 *
 * Every label on this page — ticks, capsules, the two out-of-range zone labels — goes
 * through placeLabels() (layout.ts) or is truncated to its own capsule's width
 * (truncateToFit), so a crowded zoom drops or shortens text instead of overlapping it.
 * Text is Bulgarian (entry.label is name.bg — see catalog.server.ts): both canvas fonts
 * are read from CSS custom properties that resolve to Archivo/IBM Plex Mono, which carry
 * Cyrillic; app/lib/history/timeline.ts additionally waits on `document.fonts.ready`
 * before trusting the font read at mount, so a frame drawn before the webfont finishes
 * loading gets corrected rather than staying stuck on a Latin-only fallback.
 */
import { assignRows, classifySpan, contextAt, placeLabels, type LabelCandidate, type LayoutEntry } from './layout';
import {
  CONFIG, dateOfDecimalYear, pxToTime, ticks, timeToPx, visibleEntries,
  type EntryKind, type Tick, type TimeRange, type Viewport
} from './scale';

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
  land: '#31485A', // --land — periods
  landBright: '#4A6E86', // a lightened --land — the cylinder's lit middle, and period capsules' bright stop
  rule: '#243543', // --rule — period capsule stroke
  ink: '#E6EEF3', // --ink — focused-capsule text
  ink2: '#9FB3C0', // --ink-2 — ordinary capsule text
  ink3: '#67808F', // --ink-3 — tick labels, out-of-range zone labels
  brass: '#E8A33D', // --brass — events, the centre date readout
  brass2: '#F5CE86', // --brass-2 — the centre date readout's own text
  brassDim: '#8A6425', // --brass-dim — event capsules' dim stop
  sea: '#4EA9C9', // --sea — rulers
  seaDim: '#2A5F75', // --sea-dim — ruler capsules' dim stop
  gov: '#8B84C7', // a muted violet, canvas-only — governments (cabinets; no token: distinct from period/ruler/event on purpose)
  govDim: '#3E3A5C',
  highlight: 'rgba(245,206,134,.35)', // --brass-2, low opacity — the cylinder's specular line
  labelHalo: 'rgba(8,13,19,.85)', // --abyss, high opacity
  centreLine: 'rgba(232,163,61,.32)' // --brass, faint — confined inside the cylinder only
} as const;

/** Background wash for period capsules' translucent bands, one colour per period so
 *  adjacent eras read as distinct background colour rather than a uniform tint — picked
 *  by the period's stable position in the WHOLE dataset (periodIndexOf in render()), not
 *  by draw order, so a given era's wash never changes colour as you pan. */
const PERIOD_BAND_COLORS: readonly string[] = [
  'rgba(49,72,90,.26)', 'rgba(42,95,117,.22)', 'rgba(70,58,110,.22)', 'rgba(120,90,40,.18)'
];

export const RENDER_CONFIG = {
  /** Reserved strip at the very top of the cylinder for year ticks and their labels —
   *  "year labels stay on the cylinder's top surface." */
  tickStripHeight: 28,
  tickMajorLength: 10,
  tickMinorLength: 5,
  /** Gap between the tick strip and the first wire, and between the last wire and the
   *  cylinder's own bottom edge. */
  wirePaddingTop: 8,
  wirePaddingBottom: 12,
  /** Gap between adjacent wires (period/ruler/government/event), and between two
   *  overlapping entries' sub-rows on the SAME wire. */
  wireGap: 5,
  /** Inset so two adjacent capsules never visually touch. */
  capsuleGapPx: 4,
  capsuleHPad: 10,
  capsuleMinFontPx: 10,
  capsuleMaxFontPx: 22,
  /** How much bigger the capsule containing the centre date is than its siblings on the
   *  same wire — "the current focus." */
  capsuleFocusScale: 1.28,
  eventCapsuleMinWidthPx: 14,
  centreDateGap: 10,
  centreDateFontPx: 13,
  fadeZoneLabelFontPx: 13
} as const;

/** Duration order, top to bottom inside the cylinder — periods longest-lived, events
 *  shortest (a single moment). Fixed, mirrors scale.ts's KIND_RANK. */
const WIRE_ORDER: readonly EntryKind[] = ['period', 'ruler', 'government', 'event'];

/** Where each wire "unlocks" along the cylinder's own normalised growth (0 = maximum
 *  zoom-out, 1 = day-level) and how wide the eased fade-in band is — "as the cylinder
 *  grows with zoom, more wires become visible; at the thinnest zoom only the period wire
 *  shows." Tied to the cylinder's OWN eased size (not raw pxPerYear), so a wire's
 *  appearance inherits the same smooth, never-a-snap animation the cylinder's growth
 *  already has, for free. A judgement call on exact thresholds — see CLAUDE.md. */
const WIRE_REVEAL_START: Readonly<Record<EntryKind, number>> = { period: 0, ruler: 0.22, government: 0.46, event: 0.68 };
const WIRE_REVEAL_BAND = 0.12;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

function wireRevealAt(kind: EntryKind, normFrac: number): number {
  return smoothstep((normFrac - WIRE_REVEAL_START[kind]) / WIRE_REVEAL_BAND);
}

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
 *  already be set on `ctx`), or '' if even a bare ellipsis doesn't fit — the caller's cue
 *  to skip the label but keep the capsule. */
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

function labelCandidate(id: string, anchorPx: number, widthPx: number, align: 'left' | 'center', tier: number, padPx = 0): LabelCandidate {
  const left = align === 'center' ? anchorPx - widthPx / 2 - padPx : anchorPx - padPx;
  return { id, px: left, widthPx: widthPx + padPx * 2, tier };
}

/** Clamps a CENTRED anchor so the text of width `widthPx` stays fully on screen —
 *  layout.ts stays font-metric-agnostic, so this is the renderer's own second clamp,
 *  after whatever positioned the anchor in the first place. */
function clampCentredAnchor(anchorPx: number, widthPx: number, sizePx: number, padPx: number): number {
  const half = widthPx / 2 + padPx;
  if (half * 2 >= sizePx) return sizePx / 2; // wider than the viewport itself — centre it and let it clip
  return Math.min(Math.max(anchorPx, half), sizePx - half);
}

/** Drops ticks whose px position is closer than `minGapPx` to a kept tick's — applies to
 *  the MARK itself, not just its label (placeLabels, below, separately thins the text). */
function declutterByPx(candidates: readonly Tick[], minGapPx: number): Tick[] {
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

/* -------------------------------------------------------------------------- the cylinder */

/**
 * The whole page's stage: a full-width, rounded band with a dark-bright-dark gradient
 * across its THICKNESS (not along the timeline) so it reads as lit from above, like a
 * rotating drum — a thin highlight near the top edge, a darkening vignette just inside
 * both the top and bottom edges (the curved inner surface a real tube would show), and a
 * soft drop shadow so it sits above the background. `thickness` is whatever
 * HistoryTimeline's own eased animation currently has it at — this function draws a
 * snapshot, it doesn't know or care that it's mid-animation.
 */
function drawCylinderShell(ctx: CanvasRenderingContext2D, axis: Axis, alongSizePx: number, cylinderTop: number, thickness: number): void {
  const cylinderBottom = cylinderTop + thickness;
  const radius = Math.min(thickness / 2, 26);
  const band = rectFor(axis, 0, alongSizePx, cylinderTop, cylinderBottom);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetX = axis === 'vertical' ? 10 : 0;
  ctx.shadowOffsetY = axis === 'horizontal' ? 10 : 0;
  ctx.beginPath();
  ctx.roundRect(band.x, band.y, band.w, band.h, radius);
  const p0 = project(axis, 0, cylinderTop);
  const p1 = project(axis, 0, cylinderBottom);
  const gradient = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
  gradient.addColorStop(0, COLORS.abyss);
  gradient.addColorStop(0.16, COLORS.land);
  gradient.addColorStop(0.5, COLORS.landBright);
  gradient.addColorStop(0.84, COLORS.land);
  gradient.addColorStop(1, COLORS.abyss);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore(); // the shadow must not bleed into what's drawn next

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(band.x, band.y, band.w, band.h, radius);
  ctx.clip();

  const highlightCross = cylinderTop + thickness * 0.12;
  const h0 = project(axis, 0, highlightCross);
  const h1 = project(axis, alongSizePx, highlightCross);
  ctx.strokeStyle = COLORS.highlight;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(h0.x, h0.y);
  ctx.lineTo(h1.x, h1.y);
  ctx.stroke();

  // Inner vignette: a short dark gradient just inside each edge, so the surface reads as
  // curving away rather than ending in a flat line.
  const vignetteDepth = Math.max(6, thickness * 0.1);
  for (const [edgeCross, dir] of [[cylinderTop, 1], [cylinderBottom, -1]] as const) {
    const v0 = project(axis, 0, edgeCross);
    const v1 = project(axis, 0, edgeCross + vignetteDepth * dir);
    const vGrad = ctx.createLinearGradient(v0.x, v0.y, v1.x, v1.y);
    vGrad.addColorStop(0, 'rgba(0,0,0,.4)');
    vGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vGrad;
    const r = rectFor(axis, 0, alongSizePx, edgeCross, edgeCross + vignetteDepth * dir);
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.restore();
}

/**
 * Darkens the cylinder outside the dataset's own [contentRange.from, contentRange.to] —
 * "fade the cylinder's brightness towards both outer regions" — and, where enough of that
 * empty zone is on screen to read comfortably, a muted label: "Преди <earliest year> —
 * Стара Велика България" to the left, "Бъдеще" to the right. Both zones are always
 * reachable (never fully off the pannable range) since HistoryTimeline's pan limit is
 * exactly half a viewport past each edge at maximum zoom-out.
 */
function drawOutOfRangeFade(
  ctx: CanvasRenderingContext2D, axis: Axis, monoFont: string, viewport: Viewport,
  cylinderTop: number, cylinderBottom: number, contentRange: TimeRange
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
      drawHaloText(ctx, axis, edge / 2, midCross, `Преди ${earliestYear} — Стара Велика България`, COLORS.ink3);
    }
  }
  if (endPx < viewport.sizePx) {
    const edge = Math.max(endPx, 0);
    fade(edge, viewport.sizePx);
    if (viewport.sizePx - edge > 70) {
      ctx.font = `600 ${RENDER_CONFIG.fadeZoneLabelFontPx}px ${monoFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      drawHaloText(ctx, axis, (edge + viewport.sizePx) / 2, midCross, 'Бъдеще', COLORS.ink3);
    }
  }
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

/** Ticks and their labels, drawn on the cylinder's own top surface, inside
 *  RENDER_CONFIG.tickStripHeight — "year labels stay on the cylinder's top surface." */
function drawTopTicks(ctx: CanvasRenderingContext2D, axis: Axis, monoFont: string, viewport: Viewport, cylinderTop: number): void {
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

/* ------------------------------------------------------------------------------- wires */

interface WireLayout {
  top: number;
  height: number;
  rowHeight: number;
  subRows: number;
  /** The wire's own reveal factor (0..1) — how "unlocked" it is at the current cylinder
   *  size. Applied as this wire's alpha, so it fades in rather than popping. */
  alpha: number;
}

/**
 * Splits the cylinder's inner content area into one row per visible kind, in duration
 * order, sized by how "unlocked" each kind is (wireRevealAt, itself driven by the
 * cylinder's own eased growth) AND by whether it actually has anything to show right now
 * — a kind with zero visible entries gets no row at all, so its space merges into its
 * neighbours ("fill the space instead of leaving it empty") rather than sitting reserved
 * and blank. Each kind's own sub-row count (co-occurring entries — overlapping periods,
 * co-rulers) is read off `rows` for only the entries actually on screen, so a wire's
 * capsules get taller when fewer of them are competing for the same row right now.
 */
function layoutWires(
  visibleByKind: Readonly<Record<EntryKind, TimelineEntry[]>>, rows: ReadonlyMap<string, number>,
  contentTop: number, contentBottom: number, normFrac: number
): Partial<Record<EntryKind, WireLayout>> {
  const available = Math.max(0, contentBottom - contentTop);
  const shown: EntryKind[] = [];
  const reveal: Partial<Record<EntryKind, number>> = {};
  for (const kind of WIRE_ORDER) {
    if (visibleByKind[kind].length === 0) continue;
    const r = wireRevealAt(kind, normFrac);
    if (r > 0.02) {
      shown.push(kind);
      reveal[kind] = r;
    }
  }
  if (shown.length === 0) return {};

  const totalReveal = shown.reduce((sum, k) => sum + (reveal[k] ?? 0), 0);
  const usable = Math.max(0, available - RENDER_CONFIG.wireGap * (shown.length - 1));

  const out: Partial<Record<EntryKind, WireLayout>> = {};
  let top = contentTop;
  for (const kind of shown) {
    const height = usable * ((reveal[kind] ?? 0) / totalReveal);
    let subRows = 1;
    for (const e of visibleByKind[kind]) subRows = Math.max(subRows, (rows.get(e.id) ?? 0) + 1);
    out[kind] = { top, height, rowHeight: height / subRows, subRows, alpha: reveal[kind] ?? 1 };
    top += height + RENDER_CONFIG.wireGap;
  }
  return out;
}

function kindCapsuleColors(kind: EntryKind): { dim: string; bright: string; stroke: string } {
  switch (kind) {
    case 'period': return { dim: COLORS.land, bright: COLORS.landBright, stroke: COLORS.rule };
    case 'ruler': return { dim: COLORS.seaDim, bright: COLORS.sea, stroke: COLORS.sea };
    case 'government': return { dim: COLORS.govDim, bright: COLORS.gov, stroke: COLORS.gov };
    case 'event': return { dim: COLORS.brassDim, bright: COLORS.brass, stroke: COLORS.brass };
  }
}

/** One faint rail per sub-row of `wire` — the literal "wire" its capsules sit on. */
function drawWireRails(ctx: CanvasRenderingContext2D, axis: Axis, sizePx: number, wire: WireLayout, color: string): void {
  ctx.strokeStyle = color;
  ctx.globalAlpha = wire.alpha * 0.35;
  ctx.lineWidth = 1;
  for (let row = 0; row < wire.subRows; row++) {
    const mid = wire.top + row * wire.rowHeight + wire.rowHeight / 2;
    const p0 = project(axis, 0, mid);
    const p1 = project(axis, sizePx, mid);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * `kind`'s visible entries as rounded capsules on `wire`: a cross-axis gradient fill in
 * the kind's colour (dim at the edges, bright through the middle — the same "lit from
 * above" technique as the cylinder itself), the Bulgarian name inside, clipped and
 * truncated to the capsule's own width. A period/ruler/government capsule wider than the
 * viewport (classifySpan's "pinned" mode) still draws spanning the whole width, so it
 * never disappears just because neither of its own ends is on screen. An event has no
 * duration, so it gets a small pill sized to its own text instead of a span. The one
 * entry whose span contains the centre date (`focusId`) draws larger and brighter than
 * its siblings on the same wire — "the current focus."
 */
function drawWireCapsules(
  ctx: CanvasRenderingContext2D, axis: Axis, uiFont: string, kind: EntryKind,
  entries: readonly TimelineEntry[], rows: ReadonlyMap<string, number>, viewport: Viewport,
  wire: WireLayout, focusId: string | null
): void {
  const { dim, bright, stroke } = kindCapsuleColors(kind);
  const byRow = new Map<number, TimelineEntry[]>();
  for (const e of entries) {
    const row = rows.get(e.id) ?? 0;
    (byRow.get(row) ?? byRow.set(row, []).get(row)!).push(e);
  }

  for (const [row, rowEntries] of byRow) {
    if (row >= wire.subRows) continue; // defensive: subRows is computed from this same set
    const rowTop = wire.top + row * wire.rowHeight;
    const rowMid = rowTop + wire.rowHeight / 2;
    const baseFontPx = clamp(wire.rowHeight * 0.42, RENDER_CONFIG.capsuleMinFontPx, RENDER_CONFIG.capsuleMaxFontPx);
    const baseHeight = Math.max(4, wire.rowHeight - RENDER_CONFIG.capsuleGapPx);

    for (const e of rowEntries) {
      const isFocus = e.id === focusId;
      const h = Math.min(wire.height, baseHeight * (isFocus ? RENDER_CONFIG.capsuleFocusScale : 1));
      const fontPx = Math.min(RENDER_CONFIG.capsuleMaxFontPx, baseFontPx * (isFocus ? 1.12 : 1));
      const cross0 = rowMid - h / 2;
      const cross1 = rowMid + h / 2;

      let fromPx: number;
      let toPx: number;
      if (kind === 'event') {
        ctx.font = `600 ${fontPx}px ${uiFont}`;
        const textWidth = ctx.measureText(e.label).width;
        const capsuleWidth = Math.max(RENDER_CONFIG.eventCapsuleMinWidthPx, textWidth + RENDER_CONFIG.capsuleHPad * 2);
        const centre = clampCentredAnchor(timeToPx(e.start, viewport), capsuleWidth, viewport.sizePx, 0);
        fromPx = centre - capsuleWidth / 2;
        toPx = centre + capsuleWidth / 2;
      } else {
        const span = classifySpan(e, viewport);
        if (span.mode === 'bar') {
          fromPx = span.fromPx + RENDER_CONFIG.capsuleGapPx / 2;
          toPx = span.toPx - RENDER_CONFIG.capsuleGapPx / 2;
        } else {
          fromPx = RENDER_CONFIG.capsuleGapPx;
          toPx = viewport.sizePx - RENDER_CONFIG.capsuleGapPx;
        }
      }
      if (toPx - fromPx < 2) continue;

      const r = rectFor(axis, fromPx, toPx, cross0, cross1);
      const radius = Math.min(r.w, r.h) / 2;

      ctx.save();
      ctx.globalAlpha = wire.alpha;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, radius);
      const g0 = project(axis, fromPx, cross0);
      const g1 = project(axis, fromPx, cross1);
      const grad = ctx.createLinearGradient(g0.x, g0.y, g1.x, g1.y);
      grad.addColorStop(0, dim);
      grad.addColorStop(0.5, bright);
      grad.addColorStop(1, dim);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = isFocus ? 1.5 : 1;
      ctx.strokeStyle = isFocus ? bright : stroke;
      ctx.stroke();

      const availableTextPx = (axis === 'horizontal' ? r.w : r.h) - RENDER_CONFIG.capsuleHPad * 2;
      if (availableTextPx > 6) {
        ctx.font = `${isFocus ? 700 : 500} ${fontPx}px ${uiFont}`;
        const text = truncateToFit(ctx, e.label, availableTextPx);
        if (text) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(r.x, r.y, r.w, r.h);
          ctx.clip();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          drawHaloText(ctx, axis, (fromPx + toPx) / 2, rowMid, text, isFocus ? COLORS.ink : COLORS.ink2);
          ctx.restore();
        }
      }
      ctx.restore();
    }
  }
}

/**
 * A wide translucent band per visible period, behind everything else inside the cylinder
 * — "the era is felt as background colour." Coloured by the period's stable index in the
 * WHOLE dataset (`periodIndexOf`, computed once in render() from every period, not just
 * the visible ones), so a given era's wash never changes colour as it scrolls in and out
 * of view.
 */
function drawPeriodBands(
  ctx: CanvasRenderingContext2D, axis: Axis, periods: readonly TimelineEntry[], periodIndexOf: ReadonlyMap<string, number>,
  viewport: Viewport, top: number, bottom: number
): void {
  for (const e of periods) {
    const span = classifySpan(e, viewport);
    const fromPx = span.mode === 'bar' ? span.fromPx : 0;
    const toPx = span.mode === 'bar' ? span.toPx : viewport.sizePx;
    if (toPx - fromPx < 1) continue;
    const colorIndex = (periodIndexOf.get(e.id) ?? 0) % PERIOD_BAND_COLORS.length;
    ctx.fillStyle = PERIOD_BAND_COLORS[colorIndex];
    const r = rectFor(axis, fromPx, toPx, top, bottom);
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
}

/* ------------------------------------------------------------------------ centre marker */

/** A faint line confined to the cylinder's own inner height (never outside it — "nothing
 *  outside the cylinder except the centre date readout") marking exactly where the centre
 *  date sits, so it's still legible which capsule the readout above refers to even when
 *  several sit close together. */
function drawCentreCylinderLine(ctx: CanvasRenderingContext2D, axis: Axis, viewport: Viewport, cylinderTop: number, cylinderBottom: number): void {
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
function drawCentreDate(ctx: CanvasRenderingContext2D, axis: Axis, monoFont: string, viewport: Viewport, cylinderTop: number): void {
  const alongCentre = viewport.sizePx / 2;
  ctx.font = `700 ${RENDER_CONFIG.centreDateFontPx}px ${monoFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  drawHaloText(
    ctx, axis, alongCentre, cylinderTop - RENDER_CONFIG.centreDateGap,
    formatHistoryDate(dateOfDecimalYear(viewport.center)), COLORS.brass2
  );
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
  /** The cylinder's current height, in px — HistoryTimeline's own eased animation target,
   *  already resolved to a concrete number by the time this reaches render(). */
  cylinderThicknessPx: number;
  /** [earliest authored entry, today] — draws the out-of-range fade/labels and (via
   *  minPxPerYear upstream) is what the cylinder's growth curve is normalised against. */
  contentRange: TimeRange;
}

/**
 * One frame: background, the cylinder shell (rounded, gradient, vignette, shadow), the
 * out-of-range fade + labels, the period colour wash, each visible wire's rail + capsules
 * (period, ruler, government, event, in that order — see WIRE_ORDER), the top-surface
 * ticks, then the centre line and date readout on top of everything. `entries` is the
 * WHOLE dataset — row assignment and the focus lookup both need it complete; this
 * function culls to what's on screen itself, per draw call, via visibleEntries.
 */
export function render(rc: RenderContext, entries: readonly TimelineEntry[]): void {
  const { ctx, viewport, axis, crossSizePx, dpr, uiFont, monoFont, cylinderThicknessPx, contentRange } = rc;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const full = rectFor(axis, 0, viewport.sizePx, 0, crossSizePx);
  ctx.clearRect(full.x, full.y, full.w, full.h);
  ctx.fillStyle = COLORS.abyss;
  ctx.fillRect(full.x, full.y, full.w, full.h);

  const minThickness = RENDER_CONFIG.tickStripHeight + RENDER_CONFIG.wirePaddingTop + RENDER_CONFIG.wirePaddingBottom + 14;
  const thickness = Math.max(minThickness, cylinderThicknessPx);
  const cylinderTop = crossSizePx / 2 - thickness / 2;
  const cylinderBottom = cylinderTop + thickness;

  drawCylinderShell(ctx, axis, viewport.sizePx, cylinderTop, thickness);
  drawOutOfRangeFade(ctx, axis, monoFont, viewport, cylinderTop, cylinderBottom, contentRange);

  const contentTop = cylinderTop + RENDER_CONFIG.tickStripHeight + RENDER_CONFIG.wirePaddingTop;
  const contentBottom = cylinderBottom - RENDER_CONFIG.wirePaddingBottom;

  const visible = visibleEntries(entries, viewport);
  const visibleByKind: Record<EntryKind, TimelineEntry[]> = { period: [], ruler: [], government: [], event: [] };
  for (const e of visible) visibleByKind[e.kind].push(e);

  const allPeriods = entries.filter(e => e.kind === 'period').sort((a, b) => a.start - b.start);
  const periodIndexOf = new Map(allPeriods.map((e, i) => [e.id, i] as const));
  drawPeriodBands(ctx, axis, visibleByKind.period, periodIndexOf, viewport, contentTop, contentBottom);

  const normFrac = clamp(
    (thickness / crossSizePx - CONFIG.minCylinderThicknessFrac) / (CONFIG.maxCylinderThicknessFrac - CONFIG.minCylinderThicknessFrac), 0, 1
  );
  const rows = assignRows(entries);
  const wires = layoutWires(visibleByKind, rows, contentTop, contentBottom, normFrac);

  const focus = contextAt(entries, viewport.center);
  const focusIds: Partial<Record<EntryKind, string>> = {
    ...(focus.period.primary ? { period: focus.period.primary.id } : {}),
    ...(focus.ruler.primary ? { ruler: focus.ruler.primary.id } : {}),
    ...(focus.government.primary ? { government: focus.government.primary.id } : {})
  };

  for (const kind of WIRE_ORDER) {
    const wire = wires[kind];
    if (!wire) continue;
    drawWireRails(ctx, axis, viewport.sizePx, wire, kindCapsuleColors(kind).stroke);
    drawWireCapsules(ctx, axis, uiFont, kind, visibleByKind[kind], rows, viewport, wire, focusIds[kind] ?? null);
  }

  drawTopTicks(ctx, axis, monoFont, viewport, cylinderTop);
  drawCentreCylinderLine(ctx, axis, viewport, cylinderTop, cylinderBottom);
  drawCentreDate(ctx, axis, monoFont, viewport, cylinderTop);
}
