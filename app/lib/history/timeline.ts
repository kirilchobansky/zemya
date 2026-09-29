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
import { render, type Axis, type HitRegion, type RenderContext, type TimelineEntry } from './renderer';
import { clampCenter, clampPxPerYear, CONFIG, cylinderThicknessFraction, decimalYearOfDate, pxToTime, type TimeRange, type Viewport } from './scale';

export interface HistoryHover {
  entry: TimelineEntry;
  /** The hovered region's own rect, in the same canvas CSS-pixel space as PointerEvent's
   *  offsetX/offsetY — what atlas.tsx positions the floating HistoryCard beside. */
  rect: { x: number; y: number; w: number; h: number };
}

const WHEEL_SENSITIVITY = 0.004;
const WHEEL_LINE_SENSITIVITY = 0.05;
const DRAG_THRESHOLD_PX = 3;
/** Time constant (ms) for the cylinder's own eased grow/shrink — "smooth, eased
 *  transitions, never a snap": a discrete wheel notch (one event, one target change)
 *  still animates over several frames rather than jumping straight to the new size. */
const CYLINDER_EASE_MS = 120;
/** Below this, the animation is considered converged and stops re-requesting frames on
 *  its own (a real gesture still asks for more via draw()). */
const CYLINDER_EASE_EPSILON = 0.0006;

export interface TimelineOptions {
  axis: Axis;
  entries: TimelineEntry[];
  /** Decimal year to open centred on. Omit both this and initialPxPerYear (the normal
   *  case) to open fitted to the whole dataset instead — see fitToWholeHistory. */
  initialCenter?: number;
  initialPxPerYear?: number;
  /** Called with the hovered entry + its on-screen rect, or null when nothing (or
   *  something un-hoverable) is under the pointer — see the module header on hover. */
  onHover?: (hover: HistoryHover | null) => void;
}

const DEFAULT_CENTER = 2000;
const DEFAULT_PX_PER_YEAR = 6;

export class HistoryTimeline {
  private ctx: CanvasRenderingContext2D;
  private axis: Axis;
  private entries: TimelineEntry[];
  private viewport: Viewport;
  /** [earliest authored start, today] — what fitToWholeHistory frames, and what
   *  minimum-zoom (the cylinder filling the viewport exactly, no padding) is measured
   *  against. */
  private contentRange: TimeRange;
  /** contentRange padded by half of ITS OWN width on each side — "half a viewport beyond
   *  the data... so 681 and today can each be brought to the centre marker at maximum
   *  zoom-out" — the hard bound pan clamps to. Center (not pxPerYear) clamps to this. */
  private pannableRange: TimeRange;
  private crossSizePx = 0;
  private dpr = 1;
  private uiFont = 'system-ui, sans-serif';
  private monoFont = 'ui-monospace, monospace';

  /** The cylinder's current height as a fraction of crossSizePx — eased toward
   *  cylinderThicknessFraction(viewport.pxPerYear, ...) every frame, never snapped to it
   *  directly, except on the very first frame (null means "not yet initialised"). */
  private cylinderFrac: number | null = null;
  private lastAnimationFrameTime = 0;

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
  /** Every hoverable region drawn last frame (render()'s return value) — hit-tested
   *  against on pointermove, never recomputed outside a frame. */
  private hits: HitRegion[] = [];
  private hoveredId: string | null = null;
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
    this.onHover = options.onHover ?? (() => {});
    const today = HistoryTimeline.todayDecimalYear();
    this.entries = HistoryTimeline.clipEntriesToToday(options.entries, today);
    const { content, pannable } = HistoryTimeline.computeRanges(this.entries, today);
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
    // Bulgarian text (entry.label is name.bg) must not stay stuck on a Latin-only
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

  /** Today as an exact decimal year (year + month + day, via scale.ts's
   *  decimalYearOfDate) — computed fresh in the browser at construction time, never at
   *  build time (catalog.server.ts must stay ignorant of "now" or it would freeze at the
   *  last deploy). `Date` is safe here specifically because it's read for "today", never
   *  used to parse an authored (possibly Julian, pre-1916) date — see the module header. */
  private static todayDecimalYear(): number {
    const now = new Date();
    return decimalYearOfDate({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
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
      crossSizePx: this.crossSizePx, dpr: this.dpr, uiFont: this.uiFont, monoFont: this.monoFont,
      cylinderThicknessPx: (this.cylinderFrac ?? CONFIG.minCylinderThicknessFrac) * this.crossSizePx,
      contentRange: this.contentRange,
      hoveredId: this.hoveredId
    };
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

  /** Eases `cylinderFrac` toward this frame's target fraction — never snaps, except to
   *  set the very first value with no prior frame to ease from. Keeps requesting frames
   *  (via draw()) while still visibly short of the target, so a single discrete wheel
   *  notch still animates smoothly over several frames instead of jumping once. */
  private updateCylinderAnimation(): void {
    const target = cylinderThicknessFraction(this.viewport.pxPerYear, this.minPxPerYear, CONFIG.maxPxPerYear);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.cylinderFrac === null) {
      this.cylinderFrac = target;
    } else {
      const dt = this.lastAnimationFrameTime ? Math.min(now - this.lastAnimationFrameTime, 100) : 100;
      const rate = 1 - Math.exp(-dt / CYLINDER_EASE_MS);
      this.cylinderFrac += (target - this.cylinderFrac) * rate;
    }
    this.lastAnimationFrameTime = now;
    if (Math.abs(target - this.cylinderFrac) > CYLINDER_EASE_EPSILON) this.draw();
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
    this.updateCylinderAnimation();
    this.hits = render(this.renderContext, this.entries);
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

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { distance: Math.abs(a - b), pxPerYear: this.viewport.pxPerYear, time: pxToTime((a + b) / 2, this.viewport) };
      this.drag = null;
      this.canvas.classList.remove('is-dragging');
      return;
    }

    this.drag = { alongClient: this.along(e), center: this.viewport.center };
    this.moved = false;
    this.canvas.classList.add('is-dragging');
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

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    this.canvas.classList.remove('is-dragging');
    this.drag = null;
    this.clearHover();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.clearHover();
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
