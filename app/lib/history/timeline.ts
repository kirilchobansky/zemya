/**
 * Binds the history renderer to a canvas: owns the time viewport, the render-request
 * queue, devicePixelRatio + resize handling, drag-to-pan / wheel-and-pinch-to-zoom, and
 * the cylinder's own eased size animation.
 *
 * Mirrors app/lib/map/atlas.ts's shape (render-request queue, ResizeObserver-driven
 * resize, the pointer/wheel wiring, the "hold the point under the cursor/pinch fixed"
 * technique) rather than importing it — Atlas is typed throughout against the 2D
 * geography camera, World and Feature, so it can't be reused directly for a 1D time
 * axis. This class is the same pattern, one dimension smaller, driving
 * app/lib/history/scale.ts's Viewport instead of app/lib/map/camera.ts's CameraState.
 *
 * Hover: hit-testing against the regions render() hands back each frame (see
 * HitRegion), throttled to one lookup per animation frame on pointermove, suppressed
 * entirely while dragging or pinch-zooming (their gesture handlers clear it directly
 * rather than letting a stale hit-test win a race). No selection, no keyboard yet.
 */
import { contextAt } from './layout';
import {
  render, type Axis, type HitRegion, type PinnedCardTarget, type RenderContext, type TimelineEntry
} from './renderer';
import { clampCenter, clampPxPerYear, decimalYearOfDate, pxToTime, type EntryKind, type TimeRange, type Viewport } from './scale';

/** Today as an exact decimal year (year + month + day, via scale.ts's decimalYearOfDate)
 *  — computed fresh in the browser, never at build time (catalog.server.ts must stay
 *  ignorant of "now" or it would freeze at the last deploy). `Date` is safe here
 *  specifically because it's read for "today"/camera framing, never used to parse an
 *  authored (possibly Julian, pre-1916) date — see the module header. */
function todayDecimalYear(): number {
  const now = new Date();
  return decimalYearOfDate({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

/** Fly-to framing per entry kind (routes/history.$slug.tsx's outline list —
 *  HistoryOutline.tsx — is the only caller): a period/ruler row fits its own span plus a 5%
 *  margin on each side (a ruler's span is floored to 5 years first, "minimum 5 years wide"
 *  — a judgement call on top of the brief's unspecified exact margin, applying the same 5%
 *  period uses); an event row centres on its own date with a fixed ~10 year span around it.
 *  An open-ended span (Република България has no `end`) frames against today, same as the
 *  canvas itself clips it (HistoryTimeline.clipEntriesToToday). */
const PERIOD_FLY_MARGIN = 0.05;
const EVENT_FLY_SPAN_YEARS = 10;
const RULER_FLY_MIN_SPAN_YEARS = 5;

export function flyTargetFor(entry: Pick<TimelineEntry, 'kind' | 'start' | 'end'>, sizePx: number): { centre: number; pxPerYear: number } {
  if (entry.kind === 'event') {
    return { centre: entry.start, pxPerYear: sizePx / EVENT_FLY_SPAN_YEARS };
  }
  const end = entry.end ?? todayDecimalYear();
  const rawSpan = Math.max(end - entry.start, 0);
  const span = entry.kind === 'ruler' ? Math.max(rawSpan, RULER_FLY_MIN_SPAN_YEARS) : rawSpan;
  const displaySpan = Math.max(span * (1 + 2 * PERIOD_FLY_MARGIN), 1);
  return { centre: (entry.start + end) / 2, pxPerYear: sizePx / displaySpan };
}

export interface HistoryHover {
  entry: TimelineEntry;
  /** The hovered region's own rect, in the same canvas CSS-pixel space as PointerEvent's
   *  offsetX/offsetY — what atlas.tsx positions the floating HistoryCard beside. */
  rect: { x: number; y: number; w: number; h: number };
}

const WHEEL_SENSITIVITY = 0.004;
const WHEEL_LINE_SENSITIVITY = 0.05;
const DRAG_THRESHOLD_PX = 3;
/** A pointerdown/pointerup pair counts as a click (pins the entry under it) when they're
 *  within this many CSS px of each other — "a click means pointerup with less than 4px of
 *  movement, so drags still pan the timeline" (touch has no hover, so a tap pins the same
 *  way). */
const CLICK_MOVE_THRESHOLD_PX = 4;
/** flyTo's own animation length — "animating over 500ms with ease-in-out." */
const FLY_DURATION_MS = 500;
/** How long the arrival pulse (renderer.ts's pulseId/pulseElapsedMs) stays on screen —
 *  "a pulsing white outline... for 1.5 seconds after arriving." */
const PULSE_DURATION_MS = 1500;
/** onPeriodChange's own throttle — "at most 5 updates per second." */
const PERIOD_CHANGE_THROTTLE_MS = 200;
export interface TimelineOptions {
  axis: Axis;
  entries: TimelineEntry[];
  /** Decimal year to open centred on. Omit both this and initialPxPerYear (the normal
   *  case) to open fitted to the whole dataset instead — see fitToWholeHistory. */
  initialCenter?: number;
  initialPxPerYear?: number;
  /** Fade-zone texts (countries.ts's pastLabel/futureLabel), see renderer.ts. */
  pastLabel: string;
  futureLabel: string;
  /** Called with the hovered entry + its on-screen rect, or null when nothing (or
   *  something un-hoverable) is under the pointer — see the module header on hover. */
  onHover?: (hover: HistoryHover | null) => void;
  /** Called with the clicked/tapped entry + its on-screen rect (same shape as onHover) when
   *  a click (pointerdown/pointerup within CLICK_MOVE_THRESHOLD_PX) lands on a hoverable
   *  region — pins its card (see atlas.tsx). Never fires for a drag or a pinch. */
  onEntryClick?: (hit: HistoryHover) => void;
  /** Called with the id of the period (scale.ts's `contextAt`, evaluated at the viewport's
   *  own centre date) currently "under" the centre marker — the outline list's (routes/
   *  history.$slug.tsx's HistoryOutline.tsx) "you are here" section, throttled to at
   *  most 5 calls/second (see reportPeriod) so a fast pan doesn't flood React state. */
  onPeriodChange?: (periodId: string | null) => void;
}

const DEFAULT_CENTER = 2000;
const DEFAULT_PX_PER_YEAR = 6;

export class HistoryTimeline {
  private ctx: CanvasRenderingContext2D;
  private axis: Axis;
  /** Every entry, today-clipped — what HistoryFilters.tsx's toggles filter FROM (see
   *  applyFilter) and what a pinned card's connector line resolves its target against
   *  (pinnedCardTargets) even when that entry is currently filtered out of `entries`. */
  private allEntries: TimelineEntry[];
  /** `allEntries` minus whatever HistoryFilters.tsx has hidden right now — what actually
   *  gets rendered and hit-tested (see applyFilter). Equal to `allEntries` until
   *  setFilters is first called. */
  private entries: TimelineEntry[];
  /** Kinds currently hidden by a filter chip — periods are never in here (CLAUDE.md/the
   *  filters brief: "periods are always shown"). */
  private hiddenKinds: ReadonlySet<EntryKind> = new Set();
  /** Event categories currently hidden by a filter chip. */
  private hiddenCategories: ReadonlySet<string> = new Set();
  private viewport: Viewport;
  /** [earliest authored start, today] — what fitToWholeHistory frames, and what
   *  minimum-zoom (the cylinder filling the viewport exactly, no padding) is measured
   *  against. */
  private pastLabel: string;
  private futureLabel: string;
  private contentRange: TimeRange;
  /** contentRange padded by half of ITS OWN width on each side — "half a viewport beyond
   *  the data... so 681 and today can each be brought to the centre marker at maximum
   *  zoom-out" — the hard bound pan clamps to. Center (not pxPerYear) clamps to this. */
  private pannableRange: TimeRange;
  private crossSizePx = 0;
  private crossInsets = { start: 0, end: 0 };
  private dpr = 1;
  private uiFont = 'system-ui, sans-serif';
  private monoFont = 'ui-monospace, monospace';

  private resizeObserver: ResizeObserver;
  /** Renders are requested, never issued from an event handler — at most one per
   *  animation frame, however many gesture events ask (same rule as Atlas). */
  private renderQueued = 0;
  /** True once the constructor was given an explicit starting view — then resize() must
   *  never override it with the whole-history fit. */
  private hasExplicitInitialView: boolean;
  /** True once the first resize has fit the initial view to the whole dataset — a LATER
   *  resize (an actual window/container resize) must not re-fit, or the user's own pan
   *  and zoom would be thrown away every time the window changes size. */
  private fittedInitialView = false;

  private onHover: (hover: HistoryHover | null) => void;
  private onEntryClick: (hit: HistoryHover) => void;
  private onPeriodChange: (periodId: string | null) => void;
  /** The id last actually delivered to onPeriodChange, and when — reportPeriod's own
   *  throttle state (see PERIOD_CHANGE_THROTTLE_MS). `pendingPeriodId` is `undefined` when
   *  nothing is queued, so a real `null` (no period at this moment) can still be pending. */
  private lastEmittedPeriodId: string | null = null;
  private lastPeriodEmitTime = 0;
  private pendingPeriodId: string | null | undefined = undefined;
  private periodChangeTimer: ReturnType<typeof setTimeout> | null = null;

  /** flyTo's own animation state — null when idle. Interpolated every frame in renderNow()
   *  until `t` reaches 1, then cleared (and the arrival pulse, if any, starts). */
  private flyAnim: {
    startTime: number;
    fromCenter: number;
    toCenter: number;
    fromLogPxPerYear: number;
    toLogPxPerYear: number;
    pulseEntryId: string | null;
  } | null = null;
  /** The entry currently showing the arrival pulse (renderer.ts), and when it started —
   *  cleared once PULSE_DURATION_MS has elapsed. Not cancelled by a drag/wheel/pinch (only
   *  the flight itself is — see the module header on flyTo). */
  private pulse: { id: string; startTime: number } | null = null;
  /** Every hoverable region drawn last frame (render()'s return value) — hit-tested
   *  against on pointermove, never recomputed outside a frame. */
  private hits: HitRegion[] = [];
  private hoveredId: string | null = null;
  /** Ids of every entry with an open pinned card (atlas.tsx) — set via setPinnedIds,
   *  passed straight through to render() for the persistent outline (renderer.ts). */
  private pinnedIds: ReadonlySet<string> = new Set();
  /** Every pinned card's own current DOM rect (atlas.tsx, in canvas CSS-pixel space), keyed
   *  by entry id — set via setPinnedCardRects, resolved into renderer.ts's PinnedCardTarget
   *  shape (via allEntries, so a filtered-out entry still resolves) in the renderContext
   *  getter below. */
  private pinnedCardRects: ReadonlyMap<string, { x: number; y: number; w: number; h: number }> = new Map();
  /** The pointer + hit id a pointerdown started on, kept until its matching pointerup so a
   *  same-spot click can be told apart from a drag (see CLICK_MOVE_THRESHOLD_PX). Cleared
   *  on a two-pointer (pinch) gesture — a click never fires out of a pinch. */
  private clickCandidate: { pointerId: number; clientX: number; clientY: number; id: string | null } | null = null;
  /** Latest pointer position (canvas CSS px), consumed by the throttled hover check —
   *  set on every pointermove, read at most once per animation frame. */
  private pendingHoverPoint: { x: number; y: number } | null = null;
  private hoverQueued = 0;

  private drag: { alongClient: number; center: number } | null = null;
  private moved = false;
  private pointers = new Map<number, number>(); // pointerId -> along-axis client coordinate
  /** Two-finger gesture: the moment that started under the fingers' midpoint stays under
   *  it, so a pinch zooms about where you're pinching (same technique as Atlas's pinch,
   *  in one dimension). */
  private pinch: { distance: number; pxPerYear: number; time: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, options: TimelineOptions) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2d canvas context unavailable');
    this.ctx = context;
    this.axis = options.axis;
    this.pastLabel = options.pastLabel;
    this.futureLabel = options.futureLabel;
    this.onHover = options.onHover ?? (() => {});
    this.onEntryClick = options.onEntryClick ?? (() => {});
    this.onPeriodChange = options.onPeriodChange ?? (() => {});
    const today = todayDecimalYear();
    this.allEntries = HistoryTimeline.clipEntriesToToday(options.entries, today);
    this.entries = this.allEntries;
    const { content, pannable } = HistoryTimeline.computeRanges(this.allEntries, today);
    this.contentRange = content;
    this.pannableRange = pannable;
    this.hasExplicitInitialView = options.initialCenter !== undefined || options.initialPxPerYear !== undefined;
    this.viewport = {
      center: options.initialCenter ?? DEFAULT_CENTER,
      // sizePx is 0 here (the real clamp, tied to the container's width, happens in the
      // first resize() below) — this only enforces the day-level zoom-in ceiling early.
      pxPerYear: clampPxPerYear(options.initialPxPerYear ?? DEFAULT_PX_PER_YEAR, 0, this.contentRange),
      sizePx: 0
    };

    if (typeof getComputedStyle === 'function') {
      this.uiFont = getComputedStyle(document.body).getPropertyValue('--font-ui') || this.uiFont;
      this.monoFont = getComputedStyle(document.body).getPropertyValue('--font-mono') || this.monoFont;
    }
    // Cyrillic text (entry.label of a Bulgarian country) must not stay stuck on a Latin-only
    // fallback: the values just read above may be whatever --font-ui/--font-mono resolve
    // to BEFORE the webfont (Archivo / IBM Plex Mono, both Cyrillic) has finished
    // loading. document.fonts.ready resolves once loading settles either way — with the
    // real webfont if it loaded, or confirming the fallback is what it's staying on if
    // not (e.g. offline) — so re-reading the custom properties then and asking for one
    // more render corrects a first paint that guessed wrong, without polling.
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready
        .then(() => {
          this.uiFont = getComputedStyle(document.body).getPropertyValue('--font-ui') || this.uiFont;
          this.monoFont = getComputedStyle(document.body).getPropertyValue('--font-mono') || this.monoFont;
          this.draw();
        })
        .catch(() => {});
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.resize();
  }

  /** "Nothing is drawn after today": any open-ended span (`end: null` — an ongoing period,
   *  ruler or government) is clipped to `today` rather than left open, and any event dated
   *  after `today` is dropped outright (an event has no duration to clip). */
  private static clipEntriesToToday(entries: readonly TimelineEntry[], today: number): TimelineEntry[] {
    return entries
      .filter(e => e.kind !== 'event' || e.start <= today)
      .map(e => (e.end === null ? { ...e, end: today } : e));
  }

  /** Computes both ranges once from the (already today-clipped) entry list: the raw
   *  content span (earliest authored `start` to `today`) and that span padded by half its
   *  own width on each side for pan clamping. */
  private static computeRanges(entries: readonly TimelineEntry[], today: number): { content: TimeRange; pannable: TimeRange } {
    const earliest = entries.length ? Math.min(...entries.map(e => e.start)) : DEFAULT_CENTER - 1;
    const content: TimeRange = { from: earliest, to: Math.max(today, earliest + 1) };
    const half = (content.to - content.from) / 2;
    return { content, pannable: { from: content.from - half, to: content.to + half } };
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.renderQueued);
    cancelAnimationFrame(this.hoverQueued);
    if (this.periodChangeTimer) clearTimeout(this.periodChangeTimer);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerUp);
    c.removeEventListener('pointerleave', this.onPointerUp);
    c.removeEventListener('wheel', this.onWheel);
  }

  /* ------------------------------------------------------------------------- rendering */

  private get renderContext(): RenderContext {
    return {
      ctx: this.ctx, viewport: this.viewport, axis: this.axis,
      crossSizePx: this.crossSizePx, crossInsets: this.crossInsets, dpr: this.dpr, uiFont: this.uiFont, monoFont: this.monoFont,
      contentRange: this.contentRange,
      pastLabel: this.pastLabel, futureLabel: this.futureLabel,
      hoveredId: this.hoveredId,
      pinnedIds: this.pinnedIds,
      pulseId: this.pulse?.id ?? null,
      pulseElapsedMs: this.pulse ? performance.now() - this.pulse.startTime : 0,
      pinnedCards: this.pinnedCardTargets
    };
  }

  /** Every pinnedCardRects entry resolved against allEntries (never the filtered
   *  `entries` — a pinned card whose kind/category is currently hidden still needs a real
   *  target to point its connector line at) into renderer.ts's PinnedCardTarget shape. An
   *  id with no matching entry (shouldn't happen — atlas.tsx only ever pins a real one) is
   *  silently skipped. */
  private get pinnedCardTargets(): readonly PinnedCardTarget[] {
    const out: PinnedCardTarget[] = [];
    for (const [id, rect] of this.pinnedCardRects) {
      const entry = this.allEntries.find(e => e.id === id);
      if (entry) out.push({ id, kind: entry.kind, start: entry.start, end: entry.end, rect });
    }
    return out;
  }

  /** Phone only (atlas.tsx): the strips at the top (HUD) and bottom (sheet + tab bar) of the
   *  canvas that other UI covers, so the cylinder is drawn in the part that stays visible. */
  setCrossInsets(start: number, end: number): void {
    if (start === this.crossInsets.start && end === this.crossInsets.end) return;
    this.crossInsets = { start, end };
    this.draw();
  }

  /** The viewport's own along-axis size in CSS px — what HistoryOutline.tsx's fly-to math
   *  (flyTargetFor, above) converts a target span into a pxPerYear with. */
  get viewportSizePx(): number {
    return this.viewport.sizePx;
  }

  /** Sets which entries have an open pinned card (atlas.tsx) — repaints so the persistent
   *  outline (renderer.ts) stays in sync. */
  setPinnedIds(ids: ReadonlySet<string>): void {
    this.pinnedIds = ids;
    this.draw();
  }

  /** Sets every pinned card's current DOM rect (atlas.tsx, mount + drag) — repaints so
   *  each card's connector line (renderer.ts's drawConnectorLines) tracks it live. Called
   *  on every drag frame, same as any other gesture-driven repaint (see the module header). */
  setPinnedCardRects(rects: ReadonlyMap<string, { x: number; y: number; w: number; h: number }>): void {
    this.pinnedCardRects = rects;
    this.draw();
  }

  /** HistoryFilters.tsx's own state (atlas.tsx), applied here: which kinds (never
   *  `period` — "periods are always shown") and which event categories are hidden right
   *  now. Recomputes `entries` from the full `allEntries` and repaints; contentRange/
   *  pannableRange are untouched (computed once from allEntries at construction) so
   *  toggling a filter never moves the pan/zoom limits under the reader. */
  setFilters(hiddenKinds: ReadonlySet<EntryKind>, hiddenCategories: ReadonlySet<string>): void {
    this.hiddenKinds = hiddenKinds;
    this.hiddenCategories = hiddenCategories;
    this.entries = this.allEntries.filter(e => {
      if (e.kind !== 'period' && this.hiddenKinds.has(e.kind)) return false;
      if (e.kind === 'event' && e.category && this.hiddenCategories.has(e.category)) return false;
      return true;
    });
    this.draw();
  }

  /** The zoom floor for THIS frame's sizePx: the cylinder filling the viewport with the
   *  whole content range exactly, no padding — "the cylinder fills the screen" at
   *  maximum zoom-out doubles as the pxPerYear clamp floor. Distinct from
   *  `pannableRange`, which is wider (so 681/today can still be centred once zoomed all
   *  the way out) — see clampPxPerYear's own doc on why the two ranges differ. */
  private get minPxPerYear(): number {
    const span = Math.max(this.contentRange.to - this.contentRange.from, 1);
    return this.viewport.sizePx > 0 ? this.viewport.sizePx / span : DEFAULT_PX_PER_YEAR;
  }

  private resize = (): void => {
    const host = this.canvas.parentElement ?? this.canvas;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const alongCss = this.axis === 'horizontal' ? rect.width : rect.height;
    const crossCss = this.axis === 'horizontal' ? rect.height : rect.width;
    this.viewport = { ...this.viewport, sizePx: alongCss };
    this.crossSizePx = crossCss;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    if (!this.hasExplicitInitialView && !this.fittedInitialView && this.entries.length) {
      this.fitToWholeHistory();
      this.fittedInitialView = true;
    } else {
      // A real resize (not the initial fit) can still shrink the viewport below what the
      // current pxPerYear/center allow — re-clamp so it never ends up panned or zoomed
      // past the data's own range plus margin.
      const pxPerYear = clampPxPerYear(this.viewport.pxPerYear, this.viewport.sizePx, this.contentRange);
      const center = clampCenter(this.viewport.center, pxPerYear, this.viewport.sizePx, this.pannableRange);
      this.viewport = { ...this.viewport, pxPerYear, center };
    }
    this.drawNow();
  };

  /** Opens the timeline fitted to the whole dataset: the cylinder filling the viewport
   *  edge to edge with the whole content range (earliest authored entry to today) and
   *  nothing more — the same "no padding" floor clampPxPerYear enforces as the maximum
   *  zoom-out, so this is just that floor, once, up front. Only ever runs once, on the
   *  first resize with a real sizePx (see fittedInitialView) — every later resize (a real
   *  window/container size change) must leave the current pan/zoom alone. */
  private fitToWholeHistory(): void {
    const { from, to } = this.contentRange;
    const pxPerYear = clampPxPerYear(this.minPxPerYear, this.viewport.sizePx, this.contentRange);
    const center = clampCenter((from + to) / 2, pxPerYear, this.viewport.sizePx, this.pannableRange);
    this.viewport = { ...this.viewport, pxPerYear, center };
  }

  /** Ask for a render: at most one per animation frame, however many events ask. */
  private draw = (): void => {
    if (!this.renderQueued) this.renderQueued = requestAnimationFrame(this.flush);
  };

  private flush = (): void => {
    this.renderQueued = 0;
    this.renderNow();
  };

  /** Render this frame now (a resize that must not flash). */
  private drawNow(): void {
    cancelAnimationFrame(this.renderQueued);
    this.flush();
  }

  private renderNow(): void {
    if (!this.viewport.sizePx) return;
    this.updateFlyAnimation();
    this.updatePulse();
    this.hits = render(this.renderContext, this.entries);
    this.reportPeriod();
  }

  /* ------------------------------------------------------------------------------- fly-to */

  /** Flies the camera to `centreYear`/`pxPerYear`, animating over FLY_DURATION_MS with
   *  ease-in-out (center linearly, pxPerYear log-interpolated so the zoom feels even — see
   *  the module header). Cancelled immediately by any drag, wheel or pinch (onPointerDown/
   *  onWheel clear `flyAnim`). `pulseEntryId`, if given, gets the 1.5s arrival outline
   *  (renderer.ts) once the flight lands — see updatePulse. */
  flyTo(centreYear: number, pxPerYear: number, pulseEntryId: string | null = null): void {
    const toPxPerYear = clampPxPerYear(pxPerYear, this.viewport.sizePx, this.contentRange);
    const toCenter = clampCenter(centreYear, toPxPerYear, this.viewport.sizePx, this.pannableRange);
    this.flyAnim = {
      startTime: performance.now(),
      fromCenter: this.viewport.center,
      toCenter,
      fromLogPxPerYear: Math.log(this.viewport.pxPerYear),
      toLogPxPerYear: Math.log(toPxPerYear),
      pulseEntryId
    };
    this.draw();
  }

  /** "Whole history" button (routes/history.$slug.tsx) — flies to the same fit
   *  fitToWholeHistory() snaps to on first mount, animated instead of instant. */
  flyToWholeHistory(): void {
    const { from, to } = this.contentRange;
    const pxPerYear = clampPxPerYear(this.minPxPerYear, this.viewport.sizePx, this.contentRange);
    this.flyTo((from + to) / 2, pxPerYear);
  }

  /** "Today" button (routes/history.$slug.tsx) — centres on today at the app's own
   *  default zoom (DEFAULT_PX_PER_YEAR), clamped like any other flyTo target. */
  flyToToday(): void {
    this.flyTo(todayDecimalYear(), DEFAULT_PX_PER_YEAR);
  }

  private static easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  }

  /** Advances `flyAnim` by one frame, if active — interpolates center linearly and
   *  pxPerYear on a log scale (see flyTo), re-clamping center every frame against the
   *  CURRENT (mid-flight) pxPerYear so the clamp never lags a frame behind the zoom. Starts
   *  the arrival pulse once the flight lands (t >= 1). */
  private updateFlyAnimation(): void {
    const anim = this.flyAnim;
    if (!anim) return;
    const t = Math.min((performance.now() - anim.startTime) / FLY_DURATION_MS, 1);
    const eased = HistoryTimeline.easeInOutCubic(t);
    const pxPerYear = clampPxPerYear(
      Math.exp(anim.fromLogPxPerYear + (anim.toLogPxPerYear - anim.fromLogPxPerYear) * eased),
      this.viewport.sizePx, this.contentRange
    );
    const rawCenter = anim.fromCenter + (anim.toCenter - anim.fromCenter) * eased;
    const center = clampCenter(rawCenter, pxPerYear, this.viewport.sizePx, this.pannableRange);
    this.viewport = { ...this.viewport, center, pxPerYear };
    if (t < 1) {
      this.draw();
    } else {
      this.flyAnim = null;
      if (anim.pulseEntryId) this.pulse = { id: anim.pulseEntryId, startTime: performance.now() };
    }
  }

  /** Keeps re-drawing while the arrival pulse is still within PULSE_DURATION_MS of its own
   *  start (the pulsing alpha itself is time-based — see renderer.ts's pulseElapsedMs —
   *  so this only needs to keep frames coming, not compute anything). */
  private updatePulse(): void {
    if (!this.pulse) return;
    if (performance.now() - this.pulse.startTime >= PULSE_DURATION_MS) this.pulse = null;
    else this.draw();
  }

  /* --------------------------------------------------------------------- "you are here" */

  /** Reports the period "under" the current centre date (scale.ts's contextAt, primary
   *  slot) to onPeriodChange, throttled to at most one call per PERIOD_CHANGE_THROTTLE_MS —
   *  "throttled to at most 5 updates per second." Always keeps the LATEST id (never a stale
   *  one from earlier in the throttle window): a pending call is stored in
   *  `pendingPeriodId` and overwritten in place; only the timer that flushes it is
   *  throttled. */
  private reportPeriod(): void {
    const id = contextAt(this.entries, this.viewport.center).period.primary?.id ?? null;
    if (id === this.lastEmittedPeriodId && this.pendingPeriodId === undefined) return;
    this.pendingPeriodId = id;
    if (this.periodChangeTimer) return;
    const delay = Math.max(0, PERIOD_CHANGE_THROTTLE_MS - (performance.now() - this.lastPeriodEmitTime));
    this.periodChangeTimer = setTimeout(() => {
      this.periodChangeTimer = null;
      const toEmit = this.pendingPeriodId;
      this.pendingPeriodId = undefined;
      if (toEmit === undefined || toEmit === this.lastEmittedPeriodId) return;
      this.lastEmittedPeriodId = toEmit;
      this.lastPeriodEmitTime = performance.now();
      this.onPeriodChange(toEmit);
    }, delay);
  }

  /* ---------------------------------------------------------------------------- events */

  /** The along-axis, CANVAS-relative coordinate of a pointer/wheel event (offsetX/Y, not
   *  clientX/Y — same convention as Atlas, since viewport math below is relative to the
   *  canvas's own origin, not the page's). The one place gesture code decides which
   *  screen axis is "time" (X for horizontal, Y for vertical) — the gesture-side
   *  counterpart of project() on the drawing side. */
  private along(e: { offsetX: number; offsetY: number }): number {
    return this.axis === 'horizontal' ? e.offsetX : e.offsetY;
  }

  /* ------------------------------------------------------------------------------ hover */

  /** Sets hoveredId (if changed), updates the cursor and fires onHover — the one place
   *  any of those three happen, so they can never drift out of sync. */
  private setHovered(id: string | null): void {
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.canvas.style.cursor = id ? 'pointer' : '';
    const region = id ? this.hits.find(h => h.id === id) ?? null : null;
    const entry = id ? this.entries.find(e => e.id === id) ?? null : null;
    this.onHover(region && entry ? { entry, rect: { x: region.x, y: region.y, w: region.w, h: region.h } } : null);
    this.draw(); // repaint with the new hover highlight
  }

  /** No hover while dragging or pinch-zooming (module header) — drops any pending
   *  throttled check too, so a stale point can't win the race once the gesture ends. */
  private clearHover(): void {
    this.pendingHoverPoint = null;
    cancelAnimationFrame(this.hoverQueued);
    this.hoverQueued = 0;
    this.setHovered(null);
  }

  /** Point-in-rect hit-test against last frame's regions: nearest to the pointer (by
   *  distance to the region's own centre) among those containing the point; ties go to
   *  the lower tier number, then id — see the module header. */
  private hitTest(x: number, y: number): HitRegion | null {
    let best: HitRegion | null = null;
    let bestDist = Infinity;
    for (const h of this.hits) {
      if (x < h.x || x > h.x + h.w || y < h.y || y > h.y + h.h) continue;
      const dist = Math.hypot(x - (h.x + h.w / 2), y - (h.y + h.h / 2));
      const tie = dist === bestDist;
      if (!best || dist < bestDist || (tie && (h.tier < best.tier || (h.tier === best.tier && h.id < best.id)))) {
        best = h;
        bestDist = dist;
      }
    }
    return best;
  }

  private flushHoverCheck = (): void => {
    this.hoverQueued = 0;
    const point = this.pendingHoverPoint;
    if (!point || this.drag || this.pinch) return;
    this.setHovered(this.hitTest(point.x, point.y)?.id ?? null);
  };

  /** Throttled to at most one hit-test per animation frame, however many pointermove
   *  events arrive in between. */
  private queueHoverCheck(x: number, y: number): void {
    this.pendingHoverPoint = { x, y };
    if (!this.hoverQueued) this.hoverQueued = requestAnimationFrame(this.flushHoverCheck);
  }

  /* --------------------------------------------------------------------------- gestures */

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.along(e));
    this.clearHover();
    this.flyAnim = null; // any drag/pinch cancels an in-flight flyTo immediately

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { distance: Math.abs(a - b), pxPerYear: this.viewport.pxPerYear, time: pxToTime((a + b) / 2, this.viewport) };
      this.drag = null;
      this.clickCandidate = null;
      this.canvas.classList.remove('is-dragging');
      return;
    }

    this.drag = { alongClient: this.along(e), center: this.viewport.center };
    this.moved = false;
    this.canvas.classList.add('is-dragging');
    this.clickCandidate = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, id: this.hitTest(e.offsetX, e.offsetY)?.id ?? null };
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, this.along(e));

    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.abs(a - b);
      const mid = (a + b) / 2;
      const rawPxPerYear = this.pinch.pxPerYear * (distance / Math.max(this.pinch.distance, 1));
      const pxPerYear = clampPxPerYear(rawPxPerYear, this.viewport.sizePx, this.contentRange);
      const rawCenter = this.pinch.time - (mid - this.viewport.sizePx / 2) / pxPerYear;
      const center = clampCenter(rawCenter, pxPerYear, this.viewport.sizePx, this.pannableRange);
      this.viewport = { ...this.viewport, pxPerYear, center };
      this.draw();
      return;
    }

    if (this.drag) {
      const deltaPx = this.along(e) - this.drag.alongClient;
      if (Math.abs(deltaPx) > DRAG_THRESHOLD_PX) this.moved = true;
      const rawCenter = this.drag.center - deltaPx / this.viewport.pxPerYear;
      const center = clampCenter(rawCenter, this.viewport.pxPerYear, this.viewport.sizePx, this.pannableRange);
      this.viewport = { ...this.viewport, center };
      this.draw();
      return;
    }

    this.queueHoverCheck(e.offsetX, e.offsetY);
  };

  /** Resolves this frame's pending click candidate (set on pointerdown) into a fired
   *  onEntryClick, if the matching pointerup landed within CLICK_MOVE_THRESHOLD_PX of it —
   *  a real 'pointerup' only, never pointercancel/pointerleave (both routed here too), and
   *  never mid-pinch (pointers.size is still 1, checked BEFORE the delete below). */
  private resolveClick(e: PointerEvent): void {
    const candidate = this.clickCandidate;
    if (e.type !== 'pointerup' || !candidate || candidate.pointerId !== e.pointerId || !candidate.id || this.pointers.size !== 1) return;
    const dist = Math.hypot(e.clientX - candidate.clientX, e.clientY - candidate.clientY);
    if (dist >= CLICK_MOVE_THRESHOLD_PX) return;
    const region = this.hits.find(h => h.id === candidate.id);
    const entry = this.entries.find(en => en.id === candidate.id);
    if (region && entry) this.onEntryClick({ entry, rect: { x: region.x, y: region.y, w: region.w, h: region.h } });
  }

  private onPointerUp = (e: PointerEvent): void => {
    this.resolveClick(e);
    this.clickCandidate = null;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    this.canvas.classList.remove('is-dragging');
    this.drag = null;
    this.clearHover();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.clearHover();
    this.flyAnim = null; // wheel cancels an in-flight flyTo immediately
    const along = this.along(e);
    const time = pxToTime(along, this.viewport); // the moment under the cursor
    const sensitivity = e.deltaMode === 1 ? WHEEL_LINE_SENSITIVITY : WHEEL_SENSITIVITY;
    const rawPxPerYear = this.viewport.pxPerYear * Math.exp(-e.deltaY * sensitivity);
    const pxPerYear = clampPxPerYear(rawPxPerYear, this.viewport.sizePx, this.contentRange);
    // hold the moment under the cursor still, then clamp the result to the pannable range
    const rawCenter = time - (along - this.viewport.sizePx / 2) / pxPerYear;
    const center = clampCenter(rawCenter, pxPerYear, this.viewport.sizePx, this.pannableRange);
    this.viewport = { ...this.viewport, pxPerYear, center };
    this.draw();
  };
}
