/**
 * Binds the history renderer to a canvas: owns the time viewport, the render-request
 * queue, devicePixelRatio + resize handling, and drag-to-pan / wheel-and-pinch-to-zoom.
 *
 * Mirrors app/lib/map/atlas.ts's shape (render-request queue, ResizeObserver-driven
 * resize, the pointer/wheel wiring, the "hold the point under the cursor/pinch fixed"
 * technique) rather than importing it — Atlas is typed throughout against the 2D
 * geography camera, World and Feature, so it can't be reused directly for a 1D time
 * axis. This class is the same pattern, one dimension smaller, driving
 * app/lib/history/scale.ts's Viewport instead of app/lib/map/camera.ts's CameraState.
 *
 * No hover, no selection, no keyboard — the first render has none of those yet.
 */
import { render, type Axis, type RenderContext, type TimelineEntry } from './renderer';
import { pxToTime, type Viewport } from './scale';

const WHEEL_SENSITIVITY = 0.0016;
const WHEEL_LINE_SENSITIVITY = 0.05;
const DRAG_THRESHOLD_PX = 3;
/** Bounds on pxPerYear so a runaway wheel/pinch can't zoom to zero or to infinity. Not
 *  tied to scale.ts's CONFIG.zoomThresholds, which pick tick GRANULARITY, not camera
 *  limits — these are just a safety floor/ceiling, a first-pass judgement call. */
const MIN_PX_PER_YEAR = 0.001;
const MAX_PX_PER_YEAR = 20000;
/** How much of the viewport's width the fitted span occupies on open — "a small margin",
 *  4% of empty space on each side. */
const FIT_MARGIN = 0.04;

function clampPxPerYear(pxPerYear: number): number {
  return Math.max(MIN_PX_PER_YEAR, Math.min(MAX_PX_PER_YEAR, pxPerYear));
}

export interface TimelineOptions {
  axis: Axis;
  entries: TimelineEntry[];
  /** Decimal year to open centred on. Omit both this and initialPxPerYear (the normal
   *  case) to open fitted to the whole dataset instead — see fitToWholeHistory. */
  initialCenter?: number;
  initialPxPerYear?: number;
}

const DEFAULT_CENTER = 2000;
const DEFAULT_PX_PER_YEAR = 6;

export class HistoryTimeline {
  private ctx: CanvasRenderingContext2D;
  private axis: Axis;
  private entries: TimelineEntry[];
  private viewport: Viewport;
  private crossSizePx = 0;
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
    this.entries = options.entries;
    this.hasExplicitInitialView = options.initialCenter !== undefined || options.initialPxPerYear !== undefined;
    this.viewport = {
      center: options.initialCenter ?? DEFAULT_CENTER,
      pxPerYear: clampPxPerYear(options.initialPxPerYear ?? DEFAULT_PX_PER_YEAR),
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

  destroy(): void {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.renderQueued);
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
      crossSizePx: this.crossSizePx, dpr: this.dpr, uiFont: this.uiFont, monoFont: this.monoFont
    };
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
    }
    this.drawNow();
  };

  /** Opens the timeline fitted to the whole dataset (earliest authored entry to today)
   *  with FIT_MARGIN of empty space on each side, rather than an arbitrary zoom. Only
   *  ever runs once, on the first resize with a real sizePx (see fittedInitialView) —
   *  every later resize (a real window/container size change) must leave the current
   *  pan/zoom alone. `new Date()` here is reading today's actual wall-clock date for
   *  camera framing, not parsing an authored historical date — the "never use Date"
   *  rule in scale.ts is about Julian/Gregorian ambiguity in THAT, which today's date
   *  can't have. */
  private fitToWholeHistory(): void {
    const earliest = Math.min(...this.entries.map(e => e.start));
    const today = new Date().getFullYear();
    const span = Math.max(today - earliest, 1);
    const pxPerYear = clampPxPerYear((this.viewport.sizePx * (1 - FIT_MARGIN * 2)) / span);
    this.viewport = { ...this.viewport, pxPerYear, center: (earliest + today) / 2 };
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
    render(this.renderContext, this.entries);
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

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.along(e));

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
      const pxPerYear = clampPxPerYear(this.pinch.pxPerYear * (distance / Math.max(this.pinch.distance, 1)));
      const center = this.pinch.time - (mid - this.viewport.sizePx / 2) / pxPerYear;
      this.viewport = { ...this.viewport, pxPerYear, center };
      this.draw();
      return;
    }

    if (this.drag) {
      const deltaPx = this.along(e) - this.drag.alongClient;
      if (Math.abs(deltaPx) > DRAG_THRESHOLD_PX) this.moved = true;
      this.viewport = { ...this.viewport, center: this.drag.center - deltaPx / this.viewport.pxPerYear };
      this.draw();
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    this.canvas.classList.remove('is-dragging');
    this.drag = null;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const along = this.along(e);
    const time = pxToTime(along, this.viewport); // the moment under the cursor
    const sensitivity = e.deltaMode === 1 ? WHEEL_LINE_SENSITIVITY : WHEEL_SENSITIVITY;
    const pxPerYear = clampPxPerYear(this.viewport.pxPerYear * Math.exp(-e.deltaY * sensitivity));
    // hold the moment under the cursor still
    this.viewport = { ...this.viewport, pxPerYear, center: time - (along - this.viewport.sizePx / 2) / pxPerYear };
    this.draw();
  };
}
