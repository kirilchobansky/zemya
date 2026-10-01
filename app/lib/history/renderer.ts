/**
 * Canvas renderer for the history timeline. Pure draw functions — no React, no DOM
 * beyond the CanvasRenderingContext2D they're handed. Mirrors app/lib/map/renderer.ts's
 * shape (one RenderContext, one entry-point `render()`, a literal COLORS object) but for
 * the 1D time axis instead of the 2D Mercator world.
 *
 * "Calm and dark" look: a flat vertical page-background gradient (drawBackground), a
 * single full-width content band, vertically centred and completely static — same size,
 * same position at every zoom level and pan position, a pure function of the lane layout
 * (see totalWiresHeightPx/layoutWires), never of viewport.pxPerYear. Everything except the
 * centre date readout lives INSIDE it: year
 * ticks on top, then horizontal "wires" stacked by duration (periods, rulers, governments,
 * events), each drawn as its own translucent rounded lane track (drawLaneTrack) with
 * entries as flat rounded capsules sitting inside it — no 3D gradients, highlights or
 * per-entry size changes; an entry containing the viewport centre only brightens (fill/
 * border/glow, eased over ~120ms), it never grows.
 *
 * Every function takes `axis` and goes through `project()`/`rectFor()`/`drawHaloText()`
 * to turn an (along-axis, cross-axis) position into real canvas x/y — nothing below ever
 * writes `ctx.something(x, y)` with x or y read directly off a Viewport or a screen
 * event. Only "horizontal" is driven by a route today (app/routes/history.$slug.tsx);
 * "vertical" exists so a later globe-timeline or sidebar layout costs a parameter, not a
 * rewrite.
 *
 * Colors are literals, not CSS custom properties — canvas can't read a custom property
 * cheaply every frame, same reasoning as app/lib/map/renderer.ts's COLORS. Keep these in
 * sync with app/styles/tokens.css by hand where they correspond (see that file's own
 * "change one, change both") — the per-kind colours (period/ruler/government/event) are
 * new, canvas-only variants with no token equivalent.
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
import { assignRows, classifySpan, contextAt, laneSubRowCounts, placeLabels, type LabelCandidate, type LayoutEntry } from './layout';
import {
  CONFIG, dateOfDecimalYear, levelFor, pxToTime, ticks, timeToPx, visibleRangeOverscan, ZOOM_LEVELS,
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
  /** Bulgarian summary (blurb.bg), one or two sentences — the hover card's body text. */
  blurbBg: string;
  /** Events only (null otherwise) — a key from content/history/events-bg.json's
   *  categories[], e.g. "war", "treaty" — the hover card's coloured dot + English label. */
  category: string | null;
  /** "#rrggbb" or null — period band / event category colour, authored in content/
   *  history/*.yaml. Used by the hover card's category dot. */
  color: string | null;
  precision: 'exact' | 'year' | 'circa' | 'disputed';
  /** Free-text keywords authored alongside the entry (mostly events) — shown in the
   *  pinned card's "See more" detail panel (routes/history.$slug.tsx), nowhere else. */
  tags: readonly string[];
  /** Alternate spellings (Cyrillic and Latin), authored in content/history/bg.yaml —
   *  read only by app/lib/history/search.ts, never displayed. */
  aliases: readonly string[];
  /** "old" (Julian) before 1 April 1916, "new" (Gregorian) on/after — the detail view's
   *  "Old style (Julian calendar)" note (app/components/HistoryDetail.tsx). Not used by
   *  rendering itself, only by that note. */
  style: 'old' | 'new';
}

/** One hoverable region recorded by render(), in real canvas CSS-pixel coordinates
 *  (the same space as PointerEvent's offsetX/offsetY) — axis-agnostic, since project()/
 *  rectFor() have already resolved along/cross into real x/y/w/h by the time a region is
 *  recorded. Consumed by app/lib/history/timeline.ts's hit-testing; drawn by nothing
 *  itself. */
export interface HitRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Copied off the entry, so timeline.ts's tie-break ("ties go to the lower tier
   *  number") doesn't need a second lookup. */
  tier: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
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

// "Calm and dark" palette (see CLAUDE.md-linked design pass): one flat accent hue per
// kind, used at low alpha for idle fills/rails and higher alpha for the active state —
// no gradients, no per-kind dim/bright pair.
const PERIOD_COLOR = '#8a97e8';
const RULER_COLOR = '#4fd1ea';
const GOVERNMENT_COLOR = '#b59cff';
const EVENT_COLOR = '#ffc46b';

const COLORS = {
  bgTop: '#0a0e1c', // page background gradient, top
  bgBottom: '#151b36', // page background gradient, bottom
  period: PERIOD_COLOR,
  ruler: RULER_COLOR,
  government: GOVERNMENT_COLOR,
  event: EVENT_COLOR,
  ink2: '#9FB3C0', // --ink-2 — tick labels
  ink3: '#67808F', // --ink-3 — tick labels, out-of-range zone labels
  // Capsule text is #eef1ff regardless of kind — every fill (see kindColorHex) stays dark
  // enough for it to read against. white is the capsule name, textDim the role line
  // beneath it.
  white: '#EEF1FF',
  whiteDim: 'rgba(238,241,255,.75)',
  brass2: '#F5CE86', // --brass-2 — the centre date readout's own text
  labelHalo: 'rgba(8,13,19,.85)', // --abyss, high opacity
  centreLine: 'rgba(232,163,61,.32)' // --brass, faint — confined inside the content band only
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
  capsuleMinFontPx: 15,
  capsuleMaxFontPx: 36,
  /** Fixed corner radius for a capsule's rounded rect — no longer a full pill (radius =
   *  half the short side); capped by the capsule's own half-width/height so a very small
   *  capsule still draws cleanly. */
  capsuleCornerRadiusPx: 10,
  /** A period/ruler/government bar never shrinks below this width — "always drawn as
   *  bars... thin coloured strips with no text" at far zoom, rather than disappearing
   *  once its true duration maps to under a pixel. */
  minBarWidthPx: 2,
  centreDateGap: 10,
  centreDateFontPx: 13,
  /** Inner margin at both ends of the canvas, along the time axis — event pins, dots and
   *  labels are held inside it (never drawn past it) and fade out over its own width as
   *  their true time position nears the canvas edge, rather than being cut off there. The
   *  background and lane tracks ignore this — they still run edge to edge. */
  edgeMarginPx: 24,
  fadeZoneLabelFontPx: 13,
  /** Event pin geometry — see drawEventPins. Height fractions of the event wire's own
   *  full height, by tier (1 is the loudest); tiers beyond 3 fall back to the tier-3
   *  fraction, an unspecified extrapolation of the given 1/0.65/0.4 ladder. */
  pinHeightFracByTier: { 1: 1, 2: 0.65, 3: 0.4 } as Readonly<Record<number, number>>,
  pinDotRadiusPx: 2.5,
  pinLabelGapPx: 5,
  /** Event label font size by zoom level — grows from decade zoom (14px) to month zoom
   *  and finer (20px); millennium/century read the same as decade (nothing finer to grow
   *  into yet), year sits at the midpoint — a judgement call on the exact curve. */
  pinLabelFontPxByLevel: {
    millennium: 15, century: 15, decade: 15, year: 18, month: 22, day: 22
  } as Readonly<Record<ZoomLevel, number>>
} as const;

/** Duration order, top to bottom inside the cylinder — periods longest-lived, events
 *  shortest (a single moment). Fixed, mirrors scale.ts's KIND_RANK. */
const WIRE_ORDER: readonly EntryKind[] = ['period', 'ruler', 'government', 'event'];

/** Fixed row height (px) for every lane, including period — "every lane has ONE fixed
 *  height," constant at every zoom level and never dependent on the cylinder's own size.
 *  Events get the tallest row: a pin's label can carry a second, smaller exact-date line
 *  (drawEventPins) that rulers/governments don't. Values are the original constants raised
 *  ~25% (ruler/government 36 -> 45, event 52 -> 65, period 48 -> 60) now that the cylinder
 *  itself is a fixed size rather than shrinking lanes to fit an eased container. Then raised
 *  a further ~10% (60/45/45/65 -> 66/50/50/72); capsule and pin heights and the capsule
 *  font (rowHeight * 0.42) all derive from these, and the label fonts below follow. */
const ROW_HEIGHT_BY_KIND: Readonly<Record<EntryKind, number>> = { period: 66, ruler: 50, government: 50, event: 72 };

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/** 1 through the middle of [0, sizePx], ramping linearly down to 0 as `px` crosses into
 *  the outer `margin`-wide band at either end — the fade half of the edge-margin
 *  treatment (see RENDER_CONFIG.edgeMarginPx and drawEventPins). Evaluated against the
 *  entry's own TRUE (unclamped) position, so an entry approaching the edge fades out even
 *  though clampToMargin below is holding its drawn position still. */
function edgeFade(px: number, sizePx: number, margin: number): number {
  if (px <= 0 || px >= sizePx) return 0;
  if (px < margin) return px / margin;
  if (px > sizePx - margin) return (sizePx - px) / margin;
  return 1;
}

/** The clamp half of the edge-margin treatment: never draw past the margin band, whatever
 *  the entry's true position — see edgeFade above for the accompanying opacity. */
function clampToMargin(px: number, sizePx: number, margin: number): number {
  return clamp(px, margin, sizePx - margin);
}

/** How long one full brighten/dim cycle of the arrival pulse takes (ms) — purely visual,
 *  independent of PULSE_DURATION_MS (timeline.ts), which decides when the pulse stops
 *  entirely. */
const PULSE_CYCLE_MS = 260;

/** Time constant (ms) for a capsule/pin's own idle↔active blend — "animate active/idle
 *  changes with about 120ms easing" (`rate = 1 - exp(-dt / MS)`). */
const ACTIVE_EASE_MS = 120;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Cross-frame easing state for every id's idle(0)↔active(1) blend (drawWireCapsules'
 *  fill/border/glow, drawEventPins' line/dot), keyed by entry id. Module-level, not part
 *  of RenderContext, because render() is otherwise a stateless per-frame function with no
 *  instance of its own to hold it on — safe because only one history timeline ever renders
 *  at a time (single canvas route). Holds only entries currently mid-transition; one that
 *  reaches its resting value (0, idle) is dropped rather than tracked forever. */
const activeAmounts = new Map<string, number>();
let activeAmountsLastTime = 0;

/**
 * Eases every id's own amount toward 1 (a member of `activeIds` — every entry whose span
 * currently contains the viewport centre, ALL of them at once, not a single "the" focus —
 * see render()) or back down to 0 (everything else, including whatever was active a moment
 * ago), over ACTIVE_EASE_MS. Returns the live map read back by drawWireCapsules/
 * drawEventPins; an id absent from it is simply 0 (never active, or its own ease-out
 * already finished).
 */
function updateActiveAmounts(activeIds: ReadonlySet<string>): ReadonlyMap<string, number> {
  const now = nowMs();
  const dt = activeAmountsLastTime ? Math.min(now - activeAmountsLastTime, 100) : 100;
  activeAmountsLastTime = now;
  const rate = 1 - Math.exp(-dt / ACTIVE_EASE_MS);

  for (const id of activeIds) {
    if (!activeAmounts.has(id)) activeAmounts.set(id, 0);
  }
  for (const [id, amt] of activeAmounts) {
    const target = activeIds.has(id) ? 1 : 0;
    const next = amt + (target - amt) * rate;
    if (!activeIds.has(id) && next < 0.002) {
      activeAmounts.delete(id);
    } else {
      activeAmounts.set(id, next);
    }
  }
  return activeAmounts;
}

/** The pulse's own opacity at `elapsedMs` since it started: oscillates between 0.35 and 1
 *  on a sine wave — never fully invisible, so the outline stays a smooth "pulse" rather
 *  than a blink. */
function pulseAlpha(elapsedMs: number): number {
  return 0.675 + 0.325 * Math.sin((elapsedMs / PULSE_CYCLE_MS) * Math.PI * 2);
}

/** A ZoomLevel's own pxPerYear threshold, read off CONFIG.zoomThresholds — the one place
 *  this module borrows the zoom ladder's own anchors instead of hardcoding a duplicate
 *  number, for eventTierReveal below. */
function pxPerYearThresholdFor(level: ZoomLevel): number {
  return CONFIG.zoomThresholds.find(t => t.level === level)?.minPxPerYear ?? 0;
}

/** Every lane's own row height — a fixed constant per kind (ROW_HEIGHT_BY_KIND), the same
 *  at every zoom level and independent of the cylinder's own size. */
function rowHeightFor(kind: EntryKind): number {
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
function eventTierReveal(tier: number, pxPerYear: number): number {
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
function rangeVisible<T extends { start: number; end: number | null }>(entries: readonly T[], viewport: Viewport): T[] {
  const { from, to } = visibleRangeOverscan(viewport);
  return entries.filter(e => (e.end ?? Infinity) >= from && e.start <= to);
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

/* ------------------------------------------------------------------------- the background */

/**
 * The page's whole background: a flat vertical gradient (COLORS.bgTop to COLORS.bgBottom)
 * across the canvas's real screen height — independent of the timeline axis, since it's a
 * page backdrop, not a time-axis element. Replaces the old lit-drum cylinder shell
 * entirely: no per-band gradient, highlight or vignette any more — each wire now draws its
 * own flat lane track instead (see drawLaneTrack).
 */
function drawBackground(ctx: CanvasRenderingContext2D, full: { x: number; y: number; w: number; h: number }, canvasHeightPx: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeightPx);
  gradient.addColorStop(0, COLORS.bgTop);
  gradient.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(full.x, full.y, full.w, full.h);
}

/**
 * Darkens the cylinder outside the dataset's own [contentRange.from, contentRange.to] —
 * "fade the cylinder's brightness towards both outer regions" — and, where enough of that
 * empty zone is on screen to read comfortably, a muted label: "Преди <earliest year> —
 * <pastLabel>" to the left, <futureLabel> to the right (both per country, countries.ts). Both zones are always
 * reachable (never fully off the pannable range) since HistoryTimeline's pan limit is
 * exactly half a viewport past each edge at maximum zoom-out.
 */
function drawOutOfRangeFade(
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
      drawHaloText(ctx, axis, edge / 2, midCross, `Преди ${earliestYear} — ${pastLabel}`, COLORS.ink3);
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
 * One row per kind, ALWAYS, in duration order (WIRE_ORDER) — a kind reserves its lane
 * whether or not anything of that kind is on screen right now, so a lane never collapses,
 * hides or fades for lack of visible items ("empty lanes stay visible as a faint empty
 * track"). A pure function of `subRowCounts` (laneSubRowCounts, computed once from the
 * whole dataset by the caller, never from what's currently visible) — nothing here depends
 * on zoom, the viewport's pan position, or which entries are on screen, so the whole
 * wire/lane structure (and the cylinder it's held in) is completely static; only entries'
 * own along-axis position moves (drawWireCapsules/drawEventPins, via classifySpan/
 * timeToPx). Each lane's total height is simply its own fixed row height times its own
 * fixed sub-row count — no lane ever stretches to fill spare space, and no capsule ever
 * stretches to fill its lane (drawWireCapsules always draws at rowHeightFor's own height,
 * never wire.height itself when subRows > 1).
 */
function layoutWires(subRowCounts: Readonly<Record<EntryKind, number>>, contentTop: number): Record<EntryKind, WireLayout> {
  const out = {} as Record<EntryKind, WireLayout>;
  let top = contentTop;
  for (const kind of WIRE_ORDER) {
    const subRows = Math.max(1, subRowCounts[kind] ?? 1);
    const rowHeight = rowHeightFor(kind);
    const height = rowHeight * subRows;
    out[kind] = { top, height, rowHeight, subRows };
    top += height + RENDER_CONFIG.wireGap;
  }
  return out;
}

/** The total px height every lane together needs — a constant per dataset shape
 *  (`subRowCounts`), never a function of zoom. This IS the cylinder's own thickness (see
 *  render()) rather than a floor some separately-animated size is grown to fit. */
function totalWiresHeightPx(subRowCounts: Readonly<Record<EntryKind, number>>): number {
  let total = RENDER_CONFIG.wireGap * (WIRE_ORDER.length - 1);
  for (const kind of WIRE_ORDER) {
    total += rowHeightFor(kind) * Math.max(1, subRowCounts[kind] ?? 1);
  }
  return total;
}

/** `dim`/`bright` are the capsule's OWN fill gradient stops. For period they're the
 *  cylinder's own dark/lit tones (unchanged). For ruler/government/event they're a dark
 *  shade of the kind's hue — NOT the bright accent itself, so white capsule text stays
 *  readable — derived from `stroke` (the kind's bright accent hue), which is used only
 *  for the capsule outline and, via drawWireCapsules' focus handling, the centre-focus
 *  highlight. */
function kindColorHex(kind: EntryKind): string {
  switch (kind) {
    case 'period': return COLORS.period;
    case 'ruler': return COLORS.ruler;
    case 'government': return COLORS.government;
    case 'event': return COLORS.event;
  }
}

const LANE_TRACK_FILL = 'rgba(255,255,255,.035)';
const LANE_TRACK_BORDER = 'rgba(255,255,255,.07)';
const LANE_TRACK_RADIUS = 14;

/** The lane track `kind`'s wire sits on: a full-width rounded rect (radius 14, faint white
 *  fill + border) — "each wire is a lane track", replacing the old cylinder's own shell as
 *  the visual container. Drawn once per wire, not per sub-row (sub-rows read purely from
 *  capsule vertical position within it). */
function drawLaneTrack(ctx: CanvasRenderingContext2D, axis: Axis, sizePx: number, wire: WireLayout): void {
  if (wire.height < 1) return;
  const r = rectFor(axis, 0, sizePx, wire.top, wire.top + wire.height);
  const radius = Math.min(LANE_TRACK_RADIUS, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  ctx.fillStyle = LANE_TRACK_FILL;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = LANE_TRACK_BORDER;
  ctx.stroke();
}

/** Idle → active interpolation for a capsule's own fill alpha/hue, border alpha/width and
 *  glow — driven by `amt` (0 = idle, 1 = fully active), which render()'s activeAmounts map
 *  eases toward its target over ~120ms (see updateActiveAmounts). No dimension in this
 *  table ever changes the capsule's SIZE or shape — only fill/border/glow/weight, per the
 *  "active items keep their exact size and shape" brief. Idle: fill at 0.30 alpha, 1px
 *  border at 0.65 alpha. Active: fill at 0.55 alpha (mixed slightly toward white via
 *  `whiteMix`), 1.6px border at full alpha, same soft glow. */
function activeCapsuleStyle(amt: number): { fillAlpha: number; whiteMix: number; borderAlpha: number; borderWidth: number; glowAlpha: number; bold: boolean } {
  return {
    fillAlpha: 0.3 + amt * 0.25,
    whiteMix: amt * 0.15,
    borderAlpha: 0.65 + amt * 0.35,
    borderWidth: 1 + amt * 0.6,
    glowAlpha: amt * 0.45,
    bold: amt > 0.5
  };
}

/**
 * `kind`'s visible period/ruler/government entries as rounded capsules (radius 10) on
 * `wire`: a flat fill in the kind's own colour at low alpha, a 1px border at higher alpha,
 * the Bulgarian name centred inside the capsule's own VISIBLE portion (classifySpan already
 * clips fromPx/toPx to the viewport, so the midpoint used for centring is always the
 * midpoint of what's actually on screen), clipped and truncated to the capsule's own width.
 * A capsule wider than the viewport (classifySpan's "pinned" mode) still draws spanning the
 * whole width, so it never disappears just because neither of its own ends is on screen.
 * Every entry whose span contains the centre date is "active" (see render()'s activeIds —
 * ALL of them at once, not just one) and gets a brighter fill/border, a soft glow and bold
 * text, eased in/out over ~120ms (activeAmounts) — never a size change. Events are pins,
 * not capsules — see drawEventPins.
 */
function drawWireCapsules(
  ctx: CanvasRenderingContext2D, axis: Axis, uiFont: string, kind: EntryKind,
  entries: readonly TimelineEntry[], rows: ReadonlyMap<string, number>, viewport: Viewport,
  wire: WireLayout, activeAmounts: ReadonlyMap<string, number>,
  hoveredId: string | null, pinnedIds: ReadonlySet<string>,
  pulseId: string | null, pulseElapsedMs: number, hits: HitRegion[]
): void {
  const kindHex = kindColorHex(kind);
  const byRow = new Map<number, TimelineEntry[]>();
  for (const e of entries) {
    const row = rows.get(e.id) ?? 0;
    (byRow.get(row) ?? byRow.set(row, []).get(row)!).push(e);
  }

  for (const [row, rowEntries] of byRow) {
    if (row >= wire.subRows) continue; // defensive: subRows is computed from this same set
    const rowTop = wire.top + row * wire.rowHeight;
    const rowMid = rowTop + wire.rowHeight / 2;
    const fontPx = clamp(wire.rowHeight * 0.42, RENDER_CONFIG.capsuleMinFontPx, RENDER_CONFIG.capsuleMaxFontPx);
    const h = Math.max(4, wire.rowHeight - RENDER_CONFIG.capsuleGapPx);
    const cross0 = rowMid - h / 2;
    const cross1 = rowMid + h / 2;

    for (const e of rowEntries) {
      const isHovered = e.id === hoveredId;
      const amt = activeAmounts.get(e.id) ?? 0;
      const style = activeCapsuleStyle(amt);

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
      // "Always drawn as bars... thin coloured strips at far zoom" — never skipped for
      // being narrow, just floored to a minimum visible width around its own centre.
      if (toPx - fromPx < RENDER_CONFIG.minBarWidthPx) {
        const centre = (fromPx + toPx) / 2;
        fromPx = centre - RENDER_CONFIG.minBarWidthPx / 2;
        toPx = centre + RENDER_CONFIG.minBarWidthPx / 2;
      }

      const r = rectFor(axis, fromPx, toPx, cross0, cross1);
      const radius = Math.min(RENDER_CONFIG.capsuleCornerRadiusPx, r.w / 2, r.h / 2);
      hits.push({ id: e.id, x: r.x, y: r.y, w: r.w, h: r.h, tier: e.tier });

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, radius);
      const fillHex = style.whiteMix > 0 ? shade(kindHex, -style.whiteMix) : kindHex;
      ctx.fillStyle = hexToRgba(fillHex, style.fillAlpha + (isHovered ? 0.08 : 0));
      ctx.fill();

      // The glow only applies to the border stroke — reset before any further (hover/
      // pinned/pulse) outline so those never inherit it.
      if (style.glowAlpha > 0.01) {
        ctx.shadowColor = hexToRgba(kindHex, style.glowAlpha);
        ctx.shadowBlur = 10 * amt;
      }
      ctx.lineWidth = style.borderWidth;
      ctx.strokeStyle = hexToRgba(kindHex, style.borderAlpha);
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (isHovered) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = COLORS.white;
        ctx.stroke();
      } else if (pinnedIds.has(e.id)) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = COLORS.white;
        ctx.stroke();
      }
      if (e.id === pulseId) {
        ctx.globalAlpha = pulseAlpha(pulseElapsedMs);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = COLORS.white;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const nameColor = COLORS.white;
      const roleColor = COLORS.whiteDim;

      const availableTextPx = (axis === 'horizontal' ? r.w : r.h) - RENDER_CONFIG.capsuleHPad * 2;
      if (availableTextPx > 6) {
        const crossPx = axis === 'horizontal' ? r.h : r.w;
        const roleFontPx = fontPx * 0.7;
        const lineGap = 2;
        const showRole = (kind === 'ruler' || kind === 'government') && !!e.role && crossPx >= fontPx + roleFontPx + lineGap + 2;
        // Centre text on the capsule's own VISIBLE midpoint (fromPx/toPx are already
        // clamped to the viewport by classifySpan) — never the entry's true, possibly
        // off-screen, midpoint.
        const visibleMid = (fromPx + toPx) / 2;

        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.font = `${style.bold ? 700 : 500} ${fontPx}px ${uiFont}`;
        const nameText = truncateToFit(ctx, e.label, availableTextPx);

        if (showRole) {
          const nameCross = rowMid - (roleFontPx + lineGap) / 2;
          const roleCross = rowMid + (fontPx + lineGap) / 2;
          if (nameText) drawHaloText(ctx, axis, visibleMid, nameCross, nameText, nameColor);
          ctx.font = `500 ${roleFontPx}px ${uiFont}`;
          const roleText = truncateToFit(ctx, e.role!, availableTextPx);
          if (roleText) drawHaloText(ctx, axis, visibleMid, roleCross, roleText, roleColor);
        } else if (nameText) {
          drawHaloText(ctx, axis, visibleMid, rowMid, nameText, nameColor);
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
 * ones stop short. A pin below its own tier's reveal threshold at the current zoom
 * (eventTierReveal) is skipped outright; everything else draws at `reveal` opacity, so a
 * tier fades in across its own zoom band rather than popping in at a hard cutoff. The
 * label sits to the right of the dot, name above an optional smaller exact-date line
 * (month zoom and finer only); candidates are collision-resolved through placeLabels so a
 * crowded moment keeps its most important pins' labels and silently drops the rest (the
 * pin and dot still draw regardless — only the TEXT is dropped). Pins close to the centre
 * (`activeAmounts`, same id→amount map drawWireCapsules uses — see render()'s activeIds)
 * get a thicker line and a slightly bigger dot, eased over ~120ms; the label itself never
 * changes size.
 */
/** Half-width of an event pin's hit region — the 1px pin gets 6px of tolerance on each
 *  side, per the hover brief. */
const PIN_HIT_HALF_WIDTH_PX = 6;

/** How close (in px) an event pin's exact date must sit to the centre marker to count as
 *  "active" (see render()'s activeIds) — a judgement call standing in for the brief's own
 *  unspecified exact radius. */
const PIN_ACTIVE_RADIUS_PX = 30;

function drawEventPins(
  ctx: CanvasRenderingContext2D, axis: Axis, uiFont: string, monoFont: string,
  entries: readonly TimelineEntry[], viewport: Viewport, wire: WireLayout, level: ZoomLevel,
  activeAmounts: ReadonlyMap<string, number>,
  hoveredId: string | null, pinnedIds: ReadonlySet<string>, pulseId: string | null, pulseElapsedMs: number,
  hits: HitRegion[]
): void {
  const fontPx = RENDER_CONFIG.pinLabelFontPxByLevel[level];
  const dateFontPx = Math.round(fontPx * 0.7);
  const showDate = level === 'month' || level === 'day';
  const lineGap = 2;
  const gap = RENDER_CONFIG.pinLabelGapPx;
  const dotRadius = RENDER_CONFIG.pinDotRadiusPx;

  // Tier filtering (CONFIG.maxTier's `event` column, via eventTierReveal) happens HERE,
  // not upstream in the entry list — a pin below its own reveal threshold is skipped
  // entirely (pin, dot AND label), everything else fades in smoothly rather than popping.
  // `px` is already clamped into the edge margin (RENDER_CONFIG.edgeMarginPx) — the pin,
  // dot and label all draw at this held position; `reveal` folds in edgeFade's own
  // proximity-to-edge fade, computed from the TRUE (unclamped) position, so a pin still
  // fades out as it nears the edge even though its drawn position stops moving.
  const margin = RENDER_CONFIG.edgeMarginPx;
  const onScreen = entries
    .map(e => {
      const rawPx = timeToPx(e.start, viewport);
      const reveal = eventTierReveal(e.tier, viewport.pxPerYear) * edgeFade(rawPx, viewport.sizePx, margin);
      return { e, rawPx, px: clampToMargin(rawPx, viewport.sizePx, margin), reveal };
    })
    .filter(({ rawPx, reveal }) => rawPx >= 0 && rawPx <= viewport.sizePx && reveal > 0.02);

  ctx.font = `600 ${fontPx}px ${uiFont}`;
  const candidates: LabelCandidate[] = onScreen.map(({ e, px }) =>
    labelCandidate(e.id, px + gap, ctx.measureText(e.label).width, 'left', e.tier)
  );
  const placed = new Set(placeLabels(candidates).map(c => c.id));

  for (const { e, px, reveal } of onScreen) {
    const frac = RENDER_CONFIG.pinHeightFracByTier[e.tier] ?? RENDER_CONFIG.pinHeightFracByTier[3];
    const bottom = wire.top + wire.height * frac;
    const isHovered = e.id === hoveredId;
    const amt = activeAmounts.get(e.id) ?? 0;
    const hitRect = rectFor(axis, px - PIN_HIT_HALF_WIDTH_PX, px + PIN_HIT_HALF_WIDTH_PX, wire.top, bottom);
    hits.push({ id: e.id, x: hitRect.x, y: hitRect.y, w: hitRect.w, h: hitRect.h, tier: e.tier });
    // Brightened toward white so a category's own (often dim) authored colour still reads
    // against the dark background — HistoryFilters.tsx's chips show the same colour
    // unbrightened, close enough in hue to double as this pin's legend.
    const pinColor = e.color ? shade(e.color, -0.35) : COLORS.event;

    ctx.save();
    ctx.globalAlpha = reveal;

    ctx.strokeStyle = pinColor;
    ctx.lineWidth = Math.max(isHovered ? 2 : 1, 1 + amt);
    ctx.beginPath();
    const p0 = project(axis, px, wire.top);
    const p1 = project(axis, px, bottom);
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();

    const dot = project(axis, px, bottom);
    ctx.beginPath();
    ctx.fillStyle = pinColor;
    ctx.arc(dot.x, dot.y, dotRadius * Math.max(isHovered ? 1.6 : 1, 1 + amt * 0.4), 0, Math.PI * 2);
    ctx.fill();

    if (pinnedIds.has(e.id)) {
      ctx.beginPath();
      ctx.strokeStyle = COLORS.white;
      ctx.lineWidth = 1.5;
      ctx.arc(dot.x, dot.y, dotRadius + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (e.id === pulseId) {
      ctx.beginPath();
      ctx.strokeStyle = COLORS.white;
      ctx.globalAlpha = reveal * pulseAlpha(pulseElapsedMs);
      ctx.lineWidth = 2;
      ctx.arc(dot.x, dot.y, dotRadius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = reveal;
    }

    if (placed.has(e.id)) {
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
    ctx.restore();
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

/* ------------------------------------------------------------------------- connector lines */

/** What a pinned card (app/components/HistoryCard.tsx's PinnedHistoryCard, tracked by
 *  atlas.tsx) needs handed in for its connector line — its own entry's date span (to
 *  locate the target on the timeline) and its current on-screen DOM rect, in the same
 *  canvas CSS-pixel space as HitRegion. Resolved by timeline.ts from its own full,
 *  unfiltered entry list, so a pinned entry currently hidden by a filter (HistoryFilters.tsx)
 *  still has somewhere real to point to. */
export interface PinnedCardTarget {
  id: string;
  kind: EntryKind;
  start: number;
  end: number | null;
  rect: { x: number; y: number; w: number; h: number };
}

const CONNECTOR_COLOR = 'rgba(255,255,255,.4)';
const CONNECTOR_DASH: readonly [number, number] = [4, 3];
const CONNECTOR_CHEVRON_SIZE = 5;

/** The point on `rect`'s own boundary in the direction of (tx, ty) — "the card's nearest
 *  edge" a line drawn outward from its centre would first cross. */
function nearestEdgePoint(rect: { x: number; y: number; w: number; h: number }, tx: number, ty: number): { x: number; y: number } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const halfW = Math.max(rect.w / 2, 1);
  const halfH = Math.max(rect.h / 2, 1);
  const scale = Math.min(dx !== 0 ? halfW / Math.abs(dx) : Infinity, dy !== 0 ? halfH / Math.abs(dy) : Infinity);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * For every pinned card, a thin dashed line from its own nearest edge to its entry's
 * current position on the timeline — an event targets its exact date; a period/ruler/
 * government targets the midpoint of its own span (there's no single "the" position for a
 * range), at the vertical middle of its kind's wire when that wire is currently drawn, or
 * the cylinder's own middle when it isn't (the kind is filtered off, or has nothing else
 * visible right now). When the target date is off screen, the line stops at the canvas
 * edge and a small chevron points further the way it would continue.
 */
function drawConnectorLines(
  ctx: CanvasRenderingContext2D, axis: Axis, viewport: Viewport, contentRange: TimeRange,
  wires: Partial<Record<EntryKind, WireLayout>>, cylinderTop: number, cylinderBottom: number,
  pinnedCards: readonly PinnedCardTarget[]
): void {
  if (!pinnedCards.length) return;
  ctx.save();
  ctx.strokeStyle = CONNECTOR_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash(CONNECTOR_DASH);

  for (const card of pinnedCards) {
    const t = card.kind === 'event' ? card.start : (card.start + (card.end ?? contentRange.to)) / 2;
    const rawPx = timeToPx(t, viewport);
    const wire = wires[card.kind];
    const crossMid = wire ? wire.top + wire.height / 2 : (cylinderTop + cylinderBottom) / 2;
    const onScreen = rawPx >= 0 && rawPx <= viewport.sizePx;
    const px = clamp(rawPx, 0, viewport.sizePx);
    const target = project(axis, px, crossMid);
    const from = nearestEdgePoint(card.rect, target.x, target.y);

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();

    if (!onScreen) {
      const dir = rawPx < 0 ? -1 : 1;
      const backAlong = px - dir * CONNECTOR_CHEVRON_SIZE * 1.6;
      const tip = project(axis, px, crossMid);
      const backA = project(axis, backAlong, crossMid - CONNECTOR_CHEVRON_SIZE);
      const backB = project(axis, backAlong, crossMid + CONNECTOR_CHEVRON_SIZE);
      ctx.save();
      ctx.setLineDash([]);
      ctx.fillStyle = CONNECTOR_COLOR;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(backA.x, backA.y);
      ctx.lineTo(backB.x, backB.y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
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
  /** Strips of the cross axis that something else covers (a phone's top HUD, the bottom sheet
   *  and tab bar). The cylinder is centred in what is left, never under them. 0 on desktop. */
  crossInsets: { start: number; end: number };
  dpr: number;
  uiFont: string;
  monoFont: string;
  /** [earliest authored entry, today] — draws the out-of-range fade/labels. */
  contentRange: TimeRange;
  /** Text of the fade zones before the earliest entry and after today. */
  pastLabel: string;
  futureLabel: string;
  /** The id of the entry timeline.ts's hit-testing currently has under the pointer, or
   *  null — the one capsule/pin drawn brighter + outlined (see drawWireCapsules/
   *  drawEventPins). Never the period colour wash, which isn't hoverable. */
  hoveredId: string | null;
  /** Ids of every entry with an open pinned card (atlas.tsx) — each gets a persistent
   *  1.5px white outline (see drawWireCapsules/drawEventPins) so it's clear which entry a
   *  floating card belongs to, independent of hover. */
  pinnedIds: ReadonlySet<string>;
  /** The entry HistoryOutline.tsx's fly-to just landed on, or null — reuses the hover
   *  outline style (see drawWireCapsules/drawEventPins) but pulses its opacity via
   *  `pulseElapsedMs` for PULSE_DURATION_MS after arriving (timeline.ts's updatePulse). */
  pulseId: string | null;
  /** Milliseconds since the pulse started (0 while none is active) — the pulse's own sine
   *  phase, not a 0..1 progress fraction (it has no fixed endpoint from the renderer's
   *  point of view; timeline.ts clears pulseId once its own duration elapses). */
  pulseElapsedMs: number;
  /** Every pinned card's own date span + current DOM rect — draws a connector line from
   *  each to its entry's position on the timeline (see drawConnectorLines). Empty outside
   *  the history route or while nothing is pinned. */
  pinnedCards: readonly PinnedCardTarget[];
}

/**
 * One frame: background, the cylinder shell (rounded, gradient, vignette, shadow), the
 * out-of-range fade + labels, the period colour wash, each visible wire's rail + capsules
 * (period, ruler, government, event, in that order — see WIRE_ORDER), the top-surface
 * ticks, then the centre line and date readout on top of everything. `entries` is the
 * WHOLE dataset — row assignment and the focus lookup both need it complete; this
 * function culls to what's on screen itself, per draw call, via rangeVisible (time-range
 * only, no tier check — period/ruler/government are always drawn; events tier-fade at
 * draw time instead, see drawEventPins/eventTierReveal). Zoom changes label detail only
 * (text fit, pin fonts) — the cylinder and every lane inside it are a fixed size, never
 * whether an entry is there at all.
 *
 * Returns every hoverable region drawn this frame (capsules and pins, not the period
 * colour wash) — app/lib/history/timeline.ts keeps the latest array and hit-tests the
 * pointer against it, throttled to once per animation frame.
 */
export function render(rc: RenderContext, entries: readonly TimelineEntry[]): HitRegion[] {
  const s = phoneScale(rc, entries);
  if (s === 1) return renderAt(rc, entries);
  // Everything is laid out in logical px (screen px / s) and drawn through a uniform scale, so
  // text, lanes and capsules shrink together; the time mapping lands on the same screen
  // positions. Hit regions and pinned-card rects cross the boundary, so they are converted.
  const { ctx, viewport, crossInsets } = rc;
  const sized = { ...viewport, sizePx: viewport.sizePx / s, pxPerYear: viewport.pxPerYear / s };
  const hits = renderAt({
    ...rc, viewport: sized, crossSizePx: rc.crossSizePx / s,
    crossInsets: { start: crossInsets.start / s, end: crossInsets.end / s },
    pinnedCards: rc.pinnedCards.map(c => ({ ...c, rect: { x: c.rect.x / s, y: c.rect.y / s, w: c.rect.w / s, h: c.rect.h / s } }))
  }, entries, viewport.pxPerYear, s);
  return hits.map(h => ({ ...h, x: h.x * s, y: h.y * s, w: h.w * s, h: h.h * s }));
}

/** Phone portrait (insets set): shrink the whole cylinder to fit the strip the HUD and sheet
 *  leave, with room for the centre-date line and a little air. 1 elsewhere. Never below 0.6. */
function phoneScale(rc: RenderContext, entries: readonly TimelineEntry[]): number {
  const { crossInsets, crossSizePx } = rc;
  if (crossInsets.start <= 0 && crossInsets.end <= 0) return 1;
  const thickness = RENDER_CONFIG.tickStripHeight + RENDER_CONFIG.wirePaddingTop
    + RENDER_CONFIG.wirePaddingBottom + totalWiresHeightPx(laneSubRowCounts(entries));
  const need = thickness + RENDER_CONFIG.centreDateGap + RENDER_CONFIG.centreDateFontPx + 6 + 16;
  return clamp((crossSizePx - crossInsets.start - crossInsets.end) / need, 0.6, 1);
}

function renderAt(rc: RenderContext, entries: readonly TimelineEntry[], levelPxPerYear?: number, scale = 1): HitRegion[] {
  const { ctx, viewport, axis, crossSizePx, crossInsets, dpr, uiFont, monoFont, contentRange, pastLabel, futureLabel, hoveredId, pinnedIds, pulseId, pulseElapsedMs, pinnedCards } = rc;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

  const full = rectFor(axis, 0, viewport.sizePx, 0, crossSizePx);
  ctx.clearRect(full.x, full.y, full.w, full.h);
  const canvasHeightPx = axis === 'horizontal' ? crossSizePx : viewport.sizePx;
  drawBackground(ctx, full, canvasHeightPx);

  const rows = assignRows(entries);
  const subRowCounts = laneSubRowCounts(entries);
  // The cylinder is completely static: same size, same centred position at every zoom
  // level and every pan position — a pure function of the lane layout (subRowCounts, which
  // depends only on the dataset's own shape), never of viewport.pxPerYear or any eased
  // animation target.
  const thickness = RENDER_CONFIG.tickStripHeight + RENDER_CONFIG.wirePaddingTop
    + RENDER_CONFIG.wirePaddingBottom + totalWiresHeightPx(subRowCounts);
  // Centred in the uncovered strip; below the top inset the centre-date readout still needs
  // its own line above the cylinder. With no insets (desktop) this is the plain centre.
  const visibleMid = crossInsets.start + (crossSizePx - crossInsets.start - crossInsets.end) / 2;
  const minTop = crossInsets.start > 0 ? crossInsets.start + RENDER_CONFIG.centreDateGap + RENDER_CONFIG.centreDateFontPx + 6 : -Infinity;
  const cylinderTop = Math.max(visibleMid - thickness / 2, minTop);
  const cylinderBottom = cylinderTop + thickness;

  drawOutOfRangeFade(ctx, axis, monoFont, viewport, cylinderTop, cylinderBottom, contentRange, pastLabel, futureLabel);

  const contentTop = cylinderTop + RENDER_CONFIG.tickStripHeight + RENDER_CONFIG.wirePaddingTop;
  const wires = layoutWires(subRowCounts, contentTop);
  const contentBottom = wires.event.top + wires.event.height;

  const visible = rangeVisible(entries, viewport);
  const visibleByKind: Record<EntryKind, TimelineEntry[]> = { period: [], ruler: [], government: [], event: [] };
  for (const e of visible) visibleByKind[e.kind].push(e);

  const allPeriods = entries.filter(e => e.kind === 'period').sort((a, b) => a.start - b.start);
  const periodIndexOf = new Map(allPeriods.map((e, i) => [e.id, i] as const));
  drawPeriodBands(ctx, axis, visibleByKind.period, periodIndexOf, viewport, contentTop, contentBottom);

  // Every period/ruler/government entry whose span contains the viewport centre is
  // active, ALL of them at once (contextAt's `.all`, not just `.primary`) — "an item is
  // active when the viewport centre is inside its time range... ALL overlapping items at
  // the centre are active, not only one." No single "the" focus is picked any more (no
  // size change to arbitrate between siblings).
  const focus = contextAt(entries, viewport.center);
  const activeIds = new Set<string>([...focus.period.all, ...focus.ruler.all, ...focus.government.all].map(e => e.id));

  // Event pins get the same idle→active treatment (thicker line, bigger dot — never a
  // label size change) when their exact date sits close to the centre marker, rather than
  // by containment (an event has no range to contain anything).
  for (const e of visibleByKind.event) {
    if (Math.abs(timeToPx(e.start, viewport) - viewport.sizePx / 2) < PIN_ACTIVE_RADIUS_PX) activeIds.add(e.id);
  }
  const activeAmounts = updateActiveAmounts(activeIds);

  const hits: HitRegion[] = [];
  const level = levelFor(levelPxPerYear ?? viewport.pxPerYear);
  for (const kind of WIRE_ORDER) {
    const wire = wires[kind];
    drawLaneTrack(ctx, axis, viewport.sizePx, wire);
    if (kind === 'event') {
      drawEventPins(ctx, axis, uiFont, monoFont, visibleByKind.event, viewport, wire, level, activeAmounts, hoveredId, pinnedIds, pulseId, pulseElapsedMs, hits);
      continue;
    }
    drawWireCapsules(ctx, axis, uiFont, kind, visibleByKind[kind], rows, viewport, wire, activeAmounts, hoveredId, pinnedIds, pulseId, pulseElapsedMs, hits);
  }

  drawTopTicks(ctx, axis, monoFont, viewport, cylinderTop);
  drawConnectorLines(ctx, axis, viewport, contentRange, wires, cylinderTop, cylinderBottom, pinnedCards);
  drawCentreCylinderLine(ctx, axis, viewport, cylinderTop, cylinderBottom);
  drawCentreDate(ctx, axis, monoFont, viewport, cylinderTop);

  return hits;
}
