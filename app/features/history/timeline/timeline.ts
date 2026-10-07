/**
 * Binds the history renderer to a canvas: owns the time viewport, the render-request
 * queue, devicePixelRatio + resize handling, drag-to-pan / wheel-and-pinch-to-zoom, and
 * the cylinder's own eased size animation.
 *
 * Mirrors app/engines/map/atlas.ts's shape (render-request queue, ResizeObserver-driven
 * resize, the pointer/wheel wiring, the "hold the point under the cursor/pinch fixed"
 * technique) rather than importing it — Atlas is typed throughout against the 2D
 * geography camera, World and Feature, so it can't be reused directly for a 1D time
 * axis. This class is the same pattern, one dimension smaller, driving
 * app/features/history/timeline/scale.ts's Viewport instead of app/engines/map/camera.ts's CameraState.
 *
 * Hover: hit-testing against the regions render() hands back each frame (see
 * HitRegion), throttled to one lookup per animation frame on pointermove, suppressed
 * entirely while dragging or pinch-zooming (their gesture handlers clear it directly
 * rather than letting a stale hit-test win a race). No selection, no keyboard yet.
 */
import { render, type Axis, type RenderContext, type TimelineEntry } from './renderer';
import { contextAt } from './layout';
import { startFly, stepFly, type FlyAnim } from './fly-animation';
import { fitToWholeHistory, reclampViewport, wholeHistoryTarget } from './timeline-framing';
import { FrameScheduler } from './frame-scheduler';
import { PeriodReporter } from './period-reporter';
import { clampCenter, clampPxPerYear, type EntryKind, type TimeRange, type Viewport } from './scale';
import {
  DEFAULT_CENTER, DEFAULT_PX_PER_YEAR, PULSE_DURATION_MS, todayDecimalYear,
  type HistoryHover, type TimelineOptions
} from './timeline-config';
import { FALLBACK_FONTS, onFontsSettled, readCanvasFonts, type CanvasFonts } from './timeline-fonts';
import { TimelineGestures } from './timeline-gestures';
import { TimelineHover } from './timeline-hover';
import { clipEntriesToToday, computeRanges, filterEntries, resolvePinnedTargets } from './timeline-model';

export { flyTargetFor } from './timeline-config';
export type { HistoryHover, TimelineOptions } from './timeline-config';

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
  private fonts: CanvasFonts = FALLBACK_FONTS;

  private resizeObserver: ResizeObserver;
  /** Renders are requested, never issued from an event handler (see FrameScheduler). */
  private frames = new FrameScheduler(() => this.renderNow());
  /** True once the constructor was given an explicit starting view — then resize() must
   *  never override it with the whole-history fit. */
  private hasExplicitInitialView: boolean;
  /** True once the first resize has fit the initial view to the whole dataset — a LATER
   *  resize (an actual window/container resize) must not re-fit, or the user's own pan
   *  and zoom would be thrown away every time the window changes size. */
  private fittedInitialView = false;

  private onEntryClick: (hit: HistoryHover) => void;
  private periods: PeriodReporter;
  private hover: TimelineHover;
  private gestures: TimelineGestures;

  /** flyTo's own animation state — null when idle. Interpolated every frame in renderNow()
   *  until `t` reaches 1, then cleared (and the arrival pulse, if any, starts). */
  private flyAnim: FlyAnim | null = null;
  /** The entry currently showing the arrival pulse (renderer.ts), and when it started —
   *  cleared once PULSE_DURATION_MS has elapsed. Not cancelled by a drag/wheel/pinch (only
   *  the flight itself is — see the module header on flyTo). */
  private pulse: { id: string; startTime: number } | null = null;
  /** Ids of every entry with an open pinned card (atlas.tsx) — set via setPinnedIds,
   *  passed straight through to render() for the persistent outline (renderer.ts). */
  private pinnedIds: ReadonlySet<string> = new Set();
  /** Every pinned card's own current DOM rect (atlas.tsx, in canvas CSS-pixel space), keyed
   *  by entry id — set via setPinnedCardRects, resolved into renderer.ts's PinnedCardTarget
   *  shape (via allEntries, so a filtered-out entry still resolves) in the renderContext
   *  getter below. */
  private pinnedCardRects: ReadonlyMap<string, { x: number; y: number; w: number; h: number }> = new Map();

  constructor(private canvas: HTMLCanvasElement, options: TimelineOptions) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2d canvas context unavailable');
    this.ctx = context;
    this.axis = options.axis;
    this.pastLabel = options.pastLabel;
    this.futureLabel = options.futureLabel;
    this.onEntryClick = options.onEntryClick ?? (() => {});
    this.periods = new PeriodReporter(options.onPeriodChange ?? (() => {}));
    const onHover = options.onHover ?? (() => {});
    const today = todayDecimalYear();
    this.allEntries = clipEntriesToToday(options.entries, today);
    this.entries = this.allEntries;
    const { content, pannable } = computeRanges(this.allEntries, today);
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

    this.fonts = readCanvasFonts(this.fonts);
    onFontsSettled(() => {
      this.fonts = readCanvasFonts(this.fonts);
      this.draw();
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);

    this.hover = new TimelineHover(canvas, {
      entries: () => this.entries,
      onHover,
      draw: () => this.draw(),
      isGesturing: () => this.gestures.active
    });
    this.gestures = new TimelineGestures({
      canvas,
      axis: this.axis,
      viewport: () => this.viewport,
      setViewport: v => { this.viewport = v; },
      contentRange: () => this.contentRange,
      pannableRange: () => this.pannableRange,
      draw: () => this.draw(),
      cancelFly: () => { this.flyAnim = null; },
      hover: this.hover,
      onEntryClick: hit => this.onEntryClick(hit)
    });

    this.resize();
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.frames.cancel();
    this.hover.destroy();
    this.periods.destroy();
    this.gestures.destroy();
  }

  /* ------------------------------------------------------------------------- rendering */

  private get renderContext(): RenderContext {
    return {
      ctx: this.ctx, viewport: this.viewport, axis: this.axis,
      crossSizePx: this.crossSizePx, crossInsets: this.crossInsets, dpr: this.dpr, uiFont: this.fonts.ui, monoFont: this.fonts.mono,
      contentRange: this.contentRange,
      pastLabel: this.pastLabel, futureLabel: this.futureLabel,
      hoveredId: this.hover.hoveredId,
      pinnedIds: this.pinnedIds,
      pulseId: this.pulse?.id ?? null,
      pulseElapsedMs: this.pulse ? performance.now() - this.pulse.startTime : 0,
      pinnedCards: resolvePinnedTargets(this.allEntries, this.pinnedCardRects)
    };
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
  get viewportSizePx(): number { return this.viewport.sizePx; }

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
    this.entries = filterEntries(this.allEntries, hiddenKinds, hiddenCategories);
    this.draw();
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
      this.viewport = fitToWholeHistory(this.viewport, this.contentRange, this.pannableRange);
      this.fittedInitialView = true;
    } else {
      this.viewport = reclampViewport(this.viewport, this.contentRange, this.pannableRange);
    }
    this.frames.now();
  };

  private draw = (): void => this.frames.request();

  private renderNow(): void {
    if (!this.viewport.sizePx) return;
    this.updateFlyAnimation();
    this.updatePulse();
    this.hover.hits = render(this.renderContext, this.entries);
    this.reportPeriod();
  }

  /* ------------------------------------------------------------------------------- fly-to */

  /** Flies the camera to `centreYear`/`pxPerYear`, animating over FLY_DURATION_MS with
   *  ease-in-out (center linearly, pxPerYear log-interpolated so the zoom feels even — see
   *  the module header). Cancelled immediately by any drag, wheel or pinch (the gesture
   *  handlers clear `flyAnim`). `pulseEntryId`, if given, gets the 1.5s arrival outline
   *  (renderer.ts) once the flight lands — see updatePulse. */
  flyTo(centreYear: number, pxPerYear: number, pulseEntryId: string | null = null): void {
    const toPxPerYear = clampPxPerYear(pxPerYear, this.viewport.sizePx, this.contentRange);
    const toCenter = clampCenter(centreYear, toPxPerYear, this.viewport.sizePx, this.pannableRange);
    this.flyAnim = startFly(this.viewport, toCenter, toPxPerYear, pulseEntryId, performance.now());
    this.draw();
  }
  /** "Whole history" button (routes/history/history.$slug.tsx) — flies to the same fit
   *  fitToWholeHistory() snaps to on first mount, animated instead of instant. */
  flyToWholeHistory(): void {
    const { centre, pxPerYear } = wholeHistoryTarget(this.viewport, this.contentRange);
    this.flyTo(centre, pxPerYear);
  }

  /** "Today" button (routes/history/history.$slug.tsx) — centres on today at the app's own
   *  default zoom (DEFAULT_PX_PER_YEAR), clamped like any other flyTo target. */
  flyToToday(): void {
    this.flyTo(todayDecimalYear(), DEFAULT_PX_PER_YEAR);
  }

  /** Advances `flyAnim` by one frame, if active (see stepFly). Starts the arrival pulse
   *  once the flight lands. */
  private updateFlyAnimation(): void {
    const anim = this.flyAnim;
    if (!anim) return;
    const step = stepFly(anim, this.viewport, this.contentRange, this.pannableRange, performance.now());
    this.viewport = step.viewport;
    if (!step.done) {
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

  /** Reports the period "under" the current centre date (scale.ts's contextAt, primary
   *  slot) to onPeriodChange, throttled (see PeriodReporter). */
  private reportPeriod(): void {
    this.periods.report(contextAt(this.entries, this.viewport.center).period.primary?.id ?? null);
  }
}
