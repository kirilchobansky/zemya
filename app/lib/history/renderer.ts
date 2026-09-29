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
  dateOfDecimalYear, levelFor, pxToTime, ticks, timeToPx, visibleEntries,
  type EntryKind, type Tick, type TimeRange, type Viewport, type ZoomLevel
} from './scale';

export type Axis = 'horizontal' | 'vertical';

/** A layout entry plus the one extra thing rendering needs that pure logic doesn't
 *  carry: display text. Kept separate from LayoutEntry on purpose — scale.ts/layout.ts
 *  stay ignorant of names, same as they're ignorant of YAML or JSON. Bulgarian (name.bg),
 *  not English — see catalog.server.ts. */
export interface TimelineEntry extends LayoutEntry {
  label: string;
  /** Rulers and governments only (null for period/event) — drawn as a second, smaller
   *  line beneath the name in the capsule (see drawWireCapsules). */
  role: string | null;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes `hex` toward black (amount > 0) or white (amount < 0) by `Math.abs(amount)` —
 *  the one place this module derives a "dim" or "bright" gradient stop from a design base
 *  colour, instead of hand-picking a second hex per kind. */
function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const toward = amount >= 0 ? 0 : 255;
  const f = Math.abs(amount);
  const mix = (v: number) => Math.round(v + (toward - v) * f);
  const toHex = (v: number) => mix(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Design bases (see CLAUDE.md-linked design pass): period is the dim/base tone the
// cylinder itself is built from; ruler/government/event are bright accent tones, each
// used as-is for their capsules' bright stop, with a darkened variant derived below for
// the dim stop.
const PERIOD_BASE = '#233043';
const RULER_BASE = '#2fd0ff';
const GOVERNMENT_BASE = '#b98bff';
const EVENT_BASE = '#ffb347';

const COLORS = {
  abyss: '#080D13', // --abyss
  land: PERIOD_BASE, // periods — the cylinder's own dark tone
  landBright: shade(PERIOD_BASE, -0.32), // lightened — the cylinder's lit middle, and period capsules' bright stop
  rule: shade(PERIOD_BASE, 0.12), // period capsule stroke
  ink2: '#9FB3C0', // --ink-2 — tick labels
  ink3: '#67808F', // --ink-3 — tick labels, out-of-range zone labels
  // All capsule text is plain white — every capsule fill (see kindCapsuleColors) is dark
  // enough for it to stay readable regardless of kind. white is the capsule name, whiteDim
  // the role line beneath it.
  white: '#FFFFFF',
  whiteDim: 'rgba(255,255,255,.75)',
  brass: EVENT_BASE, // the centre date readout, and the event outline/focus accent
  brass2: '#F5CE86', // --brass-2 — the centre date readout's own text
  sea: RULER_BASE, // the ruler outline/focus accent
  gov: GOVERNMENT_BASE, // the government outline/focus accent
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
  wireGap: 6,
  /** Inset so two adjacent capsules never visually touch. */
  capsuleGapPx: 5,
  capsuleHPad: 10,
  capsuleMinFontPx: 11,
  capsuleMaxFontPx: 26,
  /** Fixed corner radius for a capsule's rounded rect — no longer a full pill (radius =
   *  half the short side); capped by the capsule's own half-width/height so a very small
   *  capsule still draws cleanly. */
  capsuleCornerRadiusPx: 12,
  /** How much bigger the capsule containing the centre date is than its siblings on the
   *  same wire — "the current focus." */
  capsuleFocusScale: 1.5,
  centreDateGap: 10,
  centreDateFontPx: 13,
  fadeZoneLabelFontPx: 13,
  /** Event pin geometry — see drawEventPins. Height fractions of the event wire's own
   *  full height, by tier (1 is the loudest); tiers beyond 3 fall back to the tier-3
   *  fraction, an unspecified extrapolation of the given 1/0.65/0.4 ladder. */
  pinHeightFracByTier: { 1: 1, 2: 0.65, 3: 0.4 } as Readonly<Record<number, number>>,
  pinDotRadiusPx: 2.5,
  pinLabelGapPx: 5,
  /** Event label font size by zoom level — grows from decade zoom (11px) to month zoom
   *  and finer (16px); millennium/century read the same as decade (nothing finer to grow
   *  into yet), year sits at the midpoint — a judgement call on the exact curve. */
  pinLabelFontPxByLevel: {
    millennium: 11, century: 11, decade: 11, year: 13, month: 16, day: 16
  } as Readonly<Record<ZoomLevel, number>>
} as const;

/** Duration order, top to bottom inside the cylinder — periods longest-lived, events
 *  shortest (a single moment). Fixed, mirrors scale.ts's KIND_RANK. */
const WIRE_ORDER: readonly EntryKind[] = ['period', 'ruler', 'government', 'event'];

/** Fixed share of the non-period wire height each kind gets — "rulers and governments
 *  equal, events get the largest share." Read by layoutWires; a kind absent here (period,
 *  handled separately with its own fixed slim height) never reaches this table. */
const WIRE_HEIGHT_WEIGHT: Readonly<Partial<Record<EntryKind, number>>> = { ruler: 1, government: 1, event: 2 };

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
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
  const radius = Math.min(thickness / 2, 20);
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
}

/**
 * Splits the cylinder's inner content area into one row per visible kind, in duration
 * order — a kind with zero visible entries gets no row at all, so its space merges into
 * its neighbours ("fill the space instead of leaving it empty") rather than sitting
 * reserved and blank. Heights are FIXED shares, not zoom-dependent (every kind is always
 * fully drawn — see the module header): period gets a fixed slim height
 * (`clamp(usable * 0.22, 28, 64)`), and everything else splits whatever remains by
 * WIRE_HEIGHT_WEIGHT — rulers and governments equal, events the largest share. Each kind's
 * own sub-row count (co-occurring entries — overlapping periods, co-rulers) is read off
 * `rows` for only the entries actually on screen, so a wire's capsules get taller when
 * fewer of them are competing for the same row right now.
 */
function layoutWires(
  visibleByKind: Readonly<Record<EntryKind, TimelineEntry[]>>, rows: ReadonlyMap<string, number>,
  contentTop: number, contentBottom: number
): Partial<Record<EntryKind, WireLayout>> {
  const available = Math.max(0, contentBottom - contentTop);
  const shown = WIRE_ORDER.filter(kind => visibleByKind[kind].length > 0);
  if (shown.length === 0) return {};

  const usable = Math.max(0, available - RENDER_CONFIG.wireGap * (shown.length - 1));

  const periodHeight = shown.includes('period') ? Math.min(clamp(usable * 0.22, 28, 64), usable) : 0;
  const rest = shown.filter(k => k !== 'period');
  const restUsable = Math.max(0, usable - periodHeight);
  const totalWeight = rest.reduce((sum, k) => sum + (WIRE_HEIGHT_WEIGHT[k] ?? 1), 0);

  const out: Partial<Record<EntryKind, WireLayout>> = {};
  let top = contentTop;
  for (const kind of shown) {
    const height = kind === 'period' ? periodHeight : restUsable * ((WIRE_HEIGHT_WEIGHT[kind] ?? 1) / totalWeight);
    let subRows = 1;
    for (const e of visibleByKind[kind]) subRows = Math.max(subRows, (rows.get(e.id) ?? 0) + 1);
    out[kind] = { top, height, rowHeight: height / subRows, subRows };
    top += height + RENDER_CONFIG.wireGap;
  }
  return out;
}

/** `dim`/`bright` are the capsule's OWN fill gradient stops. For period they're the
 *  cylinder's own dark/lit tones (unchanged). For ruler/government/event they're a dark
 *  shade of the kind's hue — NOT the bright accent itself, so white capsule text stays
 *  readable — derived from `stroke` (the kind's bright accent hue), which is used only
 *  for the capsule outline and, via drawWireCapsules' focus handling, the centre-focus
 *  highlight. */
function kindCapsuleColors(kind: EntryKind): { dim: string; bright: string; stroke: string } {
  switch (kind) {
    case 'period': return { dim: COLORS.land, bright: COLORS.landBright, stroke: COLORS.rule };
    case 'ruler': return { dim: shade(COLORS.sea, 0.78), bright: shade(COLORS.sea, 0.6), stroke: COLORS.sea };
    case 'government': return { dim: shade(COLORS.gov, 0.78), bright: shade(COLORS.gov, 0.6), stroke: COLORS.gov };
    case 'event': return { dim: shade(COLORS.brass, 0.78), bright: shade(COLORS.brass, 0.6), stroke: COLORS.brass };
  }
}

/** One faint rail per sub-row of `wire` — the literal "wire" its capsules sit on. */
function drawWireRails(ctx: CanvasRenderingContext2D, axis: Axis, sizePx: number, wire: WireLayout, color: string): void {
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35;
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
 * `kind`'s visible period/ruler/government entries as rounded capsules on `wire`: a
 * cross-axis gradient fill in the kind's colour (dim at the edges, bright through the
 * middle — the same "lit from above" technique as the cylinder itself), the Bulgarian name
 * inside, clipped and truncated to the capsule's own width. A capsule wider than the
 * viewport (classifySpan's "pinned" mode) still draws spanning the whole width, so it
 * never disappears just because neither of its own ends is on screen. The one entry whose
 * span contains the centre date (`focusId`) draws larger and brighter than its siblings on
 * the same wire — "the current focus." Events are pins, not capsules — see drawEventPins.
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
      const span = classifySpan(e, viewport);
      if (span.mode === 'bar') {
        fromPx = span.fromPx + RENDER_CONFIG.capsuleGapPx / 2;
        toPx = span.toPx - RENDER_CONFIG.capsuleGapPx / 2;
      } else {
        fromPx = RENDER_CONFIG.capsuleGapPx;
        toPx = viewport.sizePx - RENDER_CONFIG.capsuleGapPx;
      }
      if (toPx - fromPx < 2) continue;

      const r = rectFor(axis, fromPx, toPx, cross0, cross1);
      const radius = Math.min(RENDER_CONFIG.capsuleCornerRadiusPx, r.w / 2, r.h / 2);

      ctx.save();
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
      // period's own focus highlight is its lightened `bright` fill tone; ruler/
      // government/event always outline in their bright accent hue (the fill itself is
      // now a dark shade of that hue, purely so it's never used for the outline) — that
      // one accent colour doubles as the centre-focus highlight, isFocus only thickens it.
      ctx.strokeStyle = kind === 'period' ? (isFocus ? bright : stroke) : stroke;
      ctx.stroke();

      // Every capsule's text is plain white — each kind's fill (dim/bright above) is dark
      // enough to keep it readable regardless of kind or focus state.
      const nameColor = COLORS.white;
      const roleColor = COLORS.whiteDim;

      const availableTextPx = (axis === 'horizontal' ? r.w : r.h) - RENDER_CONFIG.capsuleHPad * 2;
      if (availableTextPx > 6) {
        const crossPx = axis === 'horizontal' ? r.h : r.w;
        const roleFontPx = fontPx * 0.7;
        const lineGap = 2;
        const showRole = (kind === 'ruler' || kind === 'government') && !!e.role && crossPx >= fontPx + roleFontPx + lineGap + 2;

        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.font = `${isFocus ? 700 : 500} ${fontPx}px ${uiFont}`;
        const nameText = truncateToFit(ctx, e.label, availableTextPx);

        if (showRole) {
          const nameCross = rowMid - (roleFontPx + lineGap) / 2;
          const roleCross = rowMid + (fontPx + lineGap) / 2;
          if (nameText) drawHaloText(ctx, axis, (fromPx + toPx) / 2, nameCross, nameText, nameColor);
          ctx.font = `500 ${roleFontPx}px ${uiFont}`;
          const roleText = truncateToFit(ctx, e.role!, availableTextPx);
          if (roleText) drawHaloText(ctx, axis, (fromPx + toPx) / 2, roleCross, roleText, roleColor);
        } else if (nameText) {
          drawHaloText(ctx, axis, (fromPx + toPx) / 2, rowMid, nameText, nameColor);
        }
        ctx.restore();
      }
      ctx.restore();
    }
  }
}

/** `3.03.1878` — day (no leading zero), zero-padded month, full year; year-only (no dot)
 *  when the month itself is unknown. Distinct from formatHistoryDate (the centre-date
 *  readout's "3 March 1878" style) — this is the event pin's compact sub-line. */
function formatEventDateLine(d: { year: number; month: number | null; day: number | null }): string {
  const yearLabel = d.year < 0 ? `${-d.year} BC` : String(d.year);
  if (d.month == null) return yearLabel;
  return `${d.day}.${String(d.month).padStart(2, '0')}.${yearLabel}`;
}

/**
 * Events as pins, not capsules: a 1px vertical line at exactly `timeToPx(e.start)`,
 * hanging from the fixed top of the event wire (never per-row — a pin's position IS the
 * exact time, so there's nothing to row-pack), with a small dot at its bottom end. Pin
 * height is a fraction of the wire's own full height, by tier (RENDER_CONFIG.
 * pinHeightFracByTier) — the loudest (tier 1) events reach the full wire height, quieter
 * ones stop short. The label sits to the right of the dot, name above an optional smaller
 * exact-date line (month zoom and finer only); candidates are collision-resolved through
 * placeLabels so a crowded moment keeps its most important pins' labels and silently drops
 * the rest (the pin and dot still draw regardless — only the TEXT is dropped).
 */
function drawEventPins(
  ctx: CanvasRenderingContext2D, axis: Axis, uiFont: string, monoFont: string,
  entries: readonly TimelineEntry[], viewport: Viewport, wire: WireLayout, level: ZoomLevel
): void {
  const fontPx = RENDER_CONFIG.pinLabelFontPxByLevel[level];
  const dateFontPx = Math.round(fontPx * 0.7);
  const showDate = level === 'month' || level === 'day';
  const lineGap = 2;
  const gap = RENDER_CONFIG.pinLabelGapPx;
  const dotRadius = RENDER_CONFIG.pinDotRadiusPx;

  const onScreen = entries.filter(e => {
    const px = timeToPx(e.start, viewport);
    return px >= 0 && px <= viewport.sizePx;
  });

  ctx.font = `600 ${fontPx}px ${uiFont}`;
  const candidates: LabelCandidate[] = onScreen.map(e =>
    labelCandidate(e.id, timeToPx(e.start, viewport) + gap, ctx.measureText(e.label).width, 'left', e.tier)
  );
  const placed = new Set(placeLabels(candidates).map(c => c.id));

  for (const e of onScreen) {
    const px = timeToPx(e.start, viewport);
    const frac = RENDER_CONFIG.pinHeightFracByTier[e.tier] ?? RENDER_CONFIG.pinHeightFracByTier[3];
    const bottom = wire.top + wire.height * frac;

    ctx.strokeStyle = COLORS.brass;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const p0 = project(axis, px, wire.top);
    const p1 = project(axis, px, bottom);
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();

    const dot = project(axis, px, bottom);
    ctx.beginPath();
    ctx.fillStyle = COLORS.brass;
    ctx.arc(dot.x, dot.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();

    if (!placed.has(e.id)) continue;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const centreCross = bottom;
    const nameCross = showDate ? centreCross - (dateFontPx + lineGap) / 2 : centreCross;

    ctx.font = `600 ${fontPx}px ${uiFont}`;
    drawHaloText(ctx, axis, px + gap, nameCross, e.label, COLORS.white);

    if (showDate) {
      const dateCross = centreCross + (fontPx + lineGap) / 2;
      ctx.font = `500 ${dateFontPx}px ${monoFont}`;
      drawHaloText(ctx, axis, px + gap, dateCross, formatEventDateLine(dateOfDecimalYear(e.start)), COLORS.whiteDim);
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
 * function culls to what's on screen itself, per draw call, via visibleEntries. Everything
 * is always drawn (mode 'all' — no wire fade-in, no tier filtering): zoom only changes how
 * much label detail fits, never whether an entry is there at all.
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

  const visible = visibleEntries(entries, viewport, 'all');
  const visibleByKind: Record<EntryKind, TimelineEntry[]> = { period: [], ruler: [], government: [], event: [] };
  for (const e of visible) visibleByKind[e.kind].push(e);

  const allPeriods = entries.filter(e => e.kind === 'period').sort((a, b) => a.start - b.start);
  const periodIndexOf = new Map(allPeriods.map((e, i) => [e.id, i] as const));
  drawPeriodBands(ctx, axis, visibleByKind.period, periodIndexOf, viewport, contentTop, contentBottom);

  const rows = assignRows(entries);
  const wires = layoutWires(visibleByKind, rows, contentTop, contentBottom);

  const focus = contextAt(entries, viewport.center);
  const focusIds: Partial<Record<EntryKind, string>> = {
    ...(focus.period.primary ? { period: focus.period.primary.id } : {}),
    ...(focus.ruler.primary ? { ruler: focus.ruler.primary.id } : {}),
    ...(focus.government.primary ? { government: focus.government.primary.id } : {})
  };

  const level = levelFor(viewport.pxPerYear);
  for (const kind of WIRE_ORDER) {
    const wire = wires[kind];
    if (!wire) continue;
    if (kind === 'event') {
      drawEventPins(ctx, axis, uiFont, monoFont, visibleByKind.event, viewport, wire, level);
      continue;
    }
    drawWireRails(ctx, axis, viewport.sizePx, wire, kindCapsuleColors(kind).stroke);
    drawWireCapsules(ctx, axis, uiFont, kind, visibleByKind[kind], rows, viewport, wire, focusIds[kind] ?? null);
  }

  drawTopTicks(ctx, axis, monoFont, viewport, cylinderTop);
  drawCentreCylinderLine(ctx, axis, viewport, cylinderTop, cylinderBottom);
  drawCentreDate(ctx, axis, monoFont, viewport, cylinderTop);
}
