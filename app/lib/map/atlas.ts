/**
 * Binds the renderer to a canvas: owns the camera, the animation loop, and every pointer
 * interaction. Deliberately framework-free — React only tells it what to draw and listens
 * for hover and click.
 */
import {
  centreInVisible, clamp, clampZoom, frame, homeCamera, homeZoom, NO_INSETS, screenToWorld, settled,
  shortestX, step, worldToScreen, type CameraState, type Insets, type Viewport
} from './camera';
import { lonToX, latToY, wrapX, xToLon, yToLat } from './projection';
import { cameraForTarget, mainlandBox, NO_SHAPE_ZOOM_FACTOR, QUIZ_EDGE_MARGIN_PX, QUIZ_PIN_MARGIN_PX, QUIZ_POINT_MARGIN_PX, quizMinTargetPx, QUIZ_WORLD_VIEW_FACTOR, type FollowTarget } from './follow';
import { COLORS, hitOverlay, pick, pickPlace, render, scaleBar, type Pulse, type RenderContext, type Style } from './renderer';
import { reprojectToTrueSize, ringsToPath } from './topology';
import type { Feature, PlaceMark, World } from './types';

export interface AtlasCallbacks {
  /** `place` is set when the pointer is over a capital's ring — `feature` is then that
   *  capital's country, so hovering a ring also lights up its country. */
  onHover(feature: Feature | null, x: number, y: number, place?: PlaceMark | null): void;
  onSelect(feature: Feature | null): void;
  onCameraChange?(scale: { km: number; px: number }): void;
  onCompareMove?(feature: Feature, over: Feature | null): void;
}

/** How long a new-target pulse lasts. Once, not a loop. */
const PULSE_MS = 1000;
const DRAG_THRESHOLD_PX = 3;
const WHEEL_SENSITIVITY = 0.0016;
const WHEEL_LINE_SENSITIVITY = 0.05;
/** Touch is imprecise: a pin or capital ring is drawn at 4-9 px but must be hittable from a
 *  44 px target (24 px radius) — a bigger HIT area only, the drawing is unchanged. */
const TOUCH_HIT_RADIUS_PX = 24;
/** After the last pan / pinch / wheel event, wait this long, then do ONE full sharp render. */
const GESTURE_SETTLE_MS = 120;

export class Atlas {
  private ctx: CanvasRenderingContext2D;
  private viewport: Viewport = { width: 0, height: 0 };
  private dpr = 1;
  private camera: CameraState = { x: 0.5, y: 0.46, zoom: 1 };
  private target: CameraState = { x: 0.5, y: 0.46, zoom: 1 };
  private animating = false;
  /** Renders are requested, never issued from an event handler: at most one per animation frame. */
  private renderQueued = 0;
  /** The camera the canvas was last fully (sharply) rendered with. */
  private drawn: CameraState = { x: 0.5, y: 0.46, zoom: 1 };
  /**
   * While a pan, pinch, wheel or (on touch) fly-to is under way the map is NOT re-rendered: the
   * last sharp frame is snapshotted to an offscreen canvas and only that bitmap is drawn,
   * transformed by the camera's change since. No path is filled or stroked while fingers move;
   * one full render follows GESTURE_SETTLE_MS after the last event. Hover, selection and hit
   * testing never touch the bitmap — they use the real geometry.
   */
  private gesture: { cam: CameraState; timer: number; fly: boolean } | null = null;
  private snapCanvas: HTMLCanvasElement | null = null;
  private frameHandle = 0;

  private style: Style;
  private focus = new Set<Feature>();
  private uiFont = 'system-ui, sans-serif';

  private drag: { x: number; y: number; camX: number; camY: number } | null = null;
  private moved = false;
  private pointers = new Map<number, [number, number]>();
  /** Two-finger gesture: the world point under the fingers' midpoint stays under it, so a pinch
   *  zooms about where you are pinching and a two-finger drag pans. */
  private pinch: { distance: number; zoom: number; world: [number, number] } | null = null;
  /** What covers the canvas (the phone's sheet and tab bar, a quiz's HUD and input) — set by
   *  the shell, and subtracted from the viewport wherever the camera frames something. */
  private insets: Insets = NO_INSETS;

  private compare: { feature: Feature; lon: number; lat: number; path: Path2D; dragging: boolean } | null = null;

  private pulseAt: { ux: number; uy: number; start: number } | null = null;
  private pulseHandle = 0;

  private resizeObserver: ResizeObserver;

  /** True for a quiz run: the input must keep focus (and, on a phone, the keyboard must stay
   *  open) however the map is dragged, pinched or tapped. */
  private keepFocus = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private world: World,
    private callbacks: AtlasCallbacks,
    style: Style
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2d canvas context unavailable');
    this.ctx = context;
    this.style = style;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('mousedown', this.onFocusStealer);
    canvas.addEventListener('touchstart', this.onFocusStealer, { passive: false });
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDoubleClick);

    this.resize();
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.frameHandle);
    cancelAnimationFrame(this.pulseHandle);
    cancelAnimationFrame(this.renderQueued);
    if (this.gesture) clearTimeout(this.gesture.timer);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('mousedown', this.onFocusStealer);
    c.removeEventListener('touchstart', this.onFocusStealer);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerUp);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('dblclick', this.onDoubleClick);
  }

  /* ----------------------------------------------------------------- public API */

  setStyle(style: Style): void {
    this.style = style;
    this.draw();
  }

  /** Marks features for a bigger pin (renderer.ts's drawPins) — the quiz run uses this
   *  for its current target instead of moving the camera, so a small country stays
   *  findable at the world view it keeps the whole run. */
  setFocus(features: Iterable<Feature>): void {
    this.focus = new Set(features);
    this.draw();
  }

  /** During a quiz run the canvas must not take focus. Pointer events carry the drag, pinch and
   *  tap, so cancelling the compatibility events (mousedown, touchstart) — where a browser moves
   *  focus and dismisses a keyboard — costs the map nothing. */
  setKeepFocus(keep: boolean): void {
    this.keepFocus = keep;
  }

  setUiFont(font: string): void {
    this.uiFont = font;
  }

  /** Forces a repaint without moving the camera or changing style/focus — used when the
   *  world's own geometry changes under it (the full-detail payload attaching in place;
   *  see geography/world.ts's loadWorld) rather than in response to any camera/style/focus
   *  change of its own. */
  redraw(): void {
    this.draw();
  }

  /** [minLon, minLat, maxLon, maxLat] a continent quiz treats as "home", or null for the
   *  world. Set by the quiz route for the run's lifetime and cleared on unmount. */
  private regionView: [number, number, number, number] | null = null;

  setRegionView(box: [number, number, number, number] | null): void {
    this.regionView = box;
  }

  /** Tell the camera what covers the canvas. Nothing moves until the next framing decision. */
  setInsets(insets: Insets): void {
    this.insets = insets;
    this.viewport = { ...this.viewport, insets }; // clamping keeps the visible area inside the map
  }

  /** The camera `home()` returns to: the whole world, or the active continent. */
  private homeView(): CameraState {
    if (!this.regionView) return homeCamera(this.viewport, this.insets);
    const [minLon, minLat, maxLon, maxLat] = this.regionView;
    return frame(
      { x0: lonToX(minLon), x1: lonToX(maxLon), y0: latToY(maxLat), y1: latToY(minLat) },
      this.viewport,
      0.85,
      Infinity,
      this.insets
    );
  }

  home(animate = true): void {
    this.moveTo(this.homeView(), animate);
  }

  zoomBy(factor: number): void {
    this.moveTo(clamp({ ...this.target, zoom: this.target.zoom * factor }, this.viewport), true);
  }

  flyTo(feature: Feature, padding = 0.55): void {
    if (!feature.bbox) {
      const zoom = homeZoom(this.viewport) * NO_SHAPE_ZOOM_FACTOR;
      this.moveTo(
        clamp({ ...centreInVisible(feature.ux, feature.uy, zoom, this.insets), zoom }, this.viewport),
        true
      );
      return;
    }
    const [minLon, minLat, maxLon, maxLat] = feature.bbox;
    this.moveTo(
      frame(
        { x0: lonToX(minLon), x1: lonToX(maxLon), y0: latToY(maxLat), y1: latToY(minLat) },
        this.viewport,
        padding,
        Infinity,
        this.insets
      ),
      true
    );
  }

  /**
   * A quiz question just changed: put the player where they can SEE its target. This is the
   * ONE place the quiz camera decides, and it runs for every way of reaching a new question —
   * a correct answer, a skip, a reveal-then-answer — so they cannot drift apart (they had:
   * only a guess used to return the view). Two steps, in one animation:
   *   1. if the player is (heading) zoomed in past the overview, start from the home view;
   *   2. from there follow.ts decides — leave alone / centre / zoom out to fit / zoom IN until
   *      the target is legible — and only moves if the result differs from where we are.
   * Decided against where the camera is HEADING, so answers fired faster than the animation
   * still chain correctly. Never called by START or the results screen — that is home()'s job.
   */
  followTarget(request: { feature: Feature; place?: PlaceMark | null }, insets: Insets): void {
    const { feature, place } = request;
    const cam = this.target;
    const home = this.homeView();
    const base = cam.zoom > home.zoom * QUIZ_WORLD_VIEW_FACTOR ? home : cam;

    // A country whose minimum width can't be reached even at maximum zoom (Vatican City: degenerate
    // geometry, drawn as a pin at every zoom) has no width to guarantee — zooming to the cap
    // would only show a pin on empty ground. It gets neighbourhood zoom instead (cameraForTarget's
    // `box: null` path). Same idea as drawsAsPin, which is what keeps it a pin.
    const minWidthPx = quizMinTargetPx(Boolean(place));
    const mainland = feature.bbox && (feature.path || feature.fullPath) ? mainlandBox(feature) : null;
    const reachable =
      mainland && (mainland.x1 - mainland.x0) * clampZoom(minWidthPx / Math.max(mainland.x1 - mainland.x0, 1e-9), this.viewport) >= minWidthPx * 0.999;
    const box = reachable ? mainland : null;
    const target: FollowTarget = place
      ? { box, focus: { x: place.ux, y: place.uy }, fit: false, marginPx: QUIZ_POINT_MARGIN_PX, minWidthPx }
      : box
        ? { box, focus: { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }, fit: true, marginPx: QUIZ_EDGE_MARGIN_PX, minWidthPx }
        : { box: null, focus: { x: feature.ux, y: feature.uy }, fit: false, marginPx: QUIZ_PIN_MARGIN_PX, minWidthPx };
    const next = cameraForTarget(base, this.viewport, insets, target, {
      noShapeZoom: homeZoom(this.viewport) * NO_SHAPE_ZOOM_FACTOR
    });

    const dest = clamp(next ?? base, this.viewport);
    const now = clamp(cam, this.viewport);
    const moved =
      Math.abs(dest.zoom - now.zoom) > now.zoom * 1e-6 ||
      Math.abs(dest.x - now.x) > 1e-9 ||
      Math.abs(dest.y - now.y) > 1e-9;
    if (moved) this.moveTo(dest, true);
  }

  /** A single expanding ring on a new quiz target — see renderer.ts's Pulse. Skipped for
   *  people who asked for reduced motion. */
  pulse(ux: number, uy: number): void {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    cancelAnimationFrame(this.pulseHandle);
    this.pulseAt = { ux, uy, start: performance.now() };
    const tick = () => {
      this.drawNow(); // rendering clears pulseAt once it has run its course
      if (this.pulseAt) this.pulseHandle = requestAnimationFrame(tick);
    };
    this.pulseHandle = requestAnimationFrame(tick);
  }

  /** The camera as drawn right now, plus where a unit-space point lands on screen — the
   *  test seam reads this to check a target really is in view after the camera settled. */
  get view(): { x: number; y: number; zoom: number; home: number } {
    return { ...this.camera, home: homeZoom(this.viewport) };
  }

  screenPosition(ux: number, uy: number): [number, number] {
    return this.worldPointToScreen(ux, uy);
  }

  /** Frame several countries at once; falls back to the world view if they span it. */
  fit(features: Feature[], padding = 0.6): void {
    const boxed = features.filter(f => f.bbox);
    if (!boxed.length) return this.home();
    const xs: number[] = [];
    const ys: number[] = [];
    for (const f of boxed) {
      const [minLon, minLat, maxLon, maxLat] = f.bbox!;
      xs.push(lonToX(minLon), lonToX(maxLon));
      ys.push(latToY(maxLat), latToY(minLat));
    }
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    if (x1 - x0 > 0.75) return this.home();
    this.moveTo(
      frame({ x0, x1, y0: Math.min(...ys), y1: Math.max(...ys) }, this.viewport, padding, 12, this.insets),
      true
    );
  }

  startCompare(feature: Feature): boolean {
    if (!feature.polygons.length) return false;
    const [lon, lat] = feature.anchor;
    this.compare = {
      feature, lon, lat,
      path: ringsToPath(reprojectToTrueSize(feature, lon, lat)),
      dragging: false
    };
    this.emitCompare();
    this.draw();
    return true;
  }

  stopCompare(): void {
    this.compare = null;
    this.draw();
  }

  get comparing(): Feature | null {
    return this.compare?.feature ?? null;
  }

  get scale(): { km: number; px: number } {
    return scaleBar(this.camera, this.viewport);
  }

  /* -------------------------------------------------------------------- internals */

  private get renderContext(): RenderContext {
    return { ctx: this.ctx, camera: this.camera, viewport: this.viewport, dpr: this.dpr };
  }

  private resize(): void {
    const host = this.canvas.parentElement ?? this.canvas;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewport = { width: rect.width, height: rect.height, insets: this.insets };
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    if (this.camera.zoom <= 1) {
      this.camera = homeCamera(this.viewport, this.insets);
      this.target = { ...this.camera };
    } else {
      this.camera = clamp(this.camera, this.viewport);
      this.target = clamp(this.target, this.viewport);
    }
    if (this.gesture) clearTimeout(this.gesture.timer);
    this.gesture = null; // the snapshot is the wrong size now
    this.drawNow();
  }

  private moveTo(next: CameraState, animate: boolean): void {
    this.target = clamp({ ...next, x: shortestX(this.camera.x, next.x) }, this.viewport);
    if (!animate) {
      this.camera = { ...this.target, x: wrapX(this.target.x) };
      this.target = { ...this.camera };
      this.draw();
      return;
    }
    // On touch, a fly-to that stays inside what is already on screen (zooming in on a country
    // you can see) animates the snapshot instead of re-rendering every frame. A fly to somewhere
    // the snapshot has no pixels for renders normally.
    const bitmap = this.coarse() && this.destinationOnScreen();
    if (!bitmap && this.gesture?.fly) this.endGesture(false);
    if (bitmap && !this.gesture) this.beginGesture(true);
    if (this.animating) return;
    this.animating = true;
    const tick = () => {
      this.camera = clamp(step(this.camera, this.target), this.viewport);
      if (settled(this.camera, this.target)) {
        const x = wrapX(this.target.x);
        this.camera = { ...this.target, x };
        this.target = { ...this.camera };
        this.animating = false;
        if (this.gesture?.fly) this.endGesture(false);
        this.drawNow();
        return;
      }
      this.drawNow();
      this.frameHandle = requestAnimationFrame(tick);
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  private coarse(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  }

  /** Is the whole view at the destination camera inside the view drawn right now? */
  private destinationOnScreen(): boolean {
    const { width, height } = this.viewport;
    for (const [sx, sy] of [[0, 0], [width, height]] as const) {
      const [wx, wy] = screenToWorld(this.target, this.viewport, sx, sy);
      const [x, y] = worldToScreen(this.drawn, this.viewport, wx, wy);
      if (x < 0 || y < 0 || x > width || y > height) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------ gesture bitmap */

  private beginGesture(fly: boolean): void {
    if (this.renderQueued) this.drawNow(); // the snapshot must be a sharp frame
    const snap = (this.snapCanvas ??= document.createElement('canvas'));
    snap.width = this.canvas.width;
    snap.height = this.canvas.height;
    snap.getContext('2d')?.drawImage(this.canvas, 0, 0);
    this.gesture = { cam: { ...this.drawn }, timer: 0, fly };
  }

  /** Called on every pan / pinch / wheel event: the first starts the bitmap mode, each one
   *  pushes the sharp render GESTURE_SETTLE_MS further out. */
  private touchGesture(): void {
    if (!this.gesture) this.beginGesture(false);
    const g = this.gesture!;
    g.fly = false;
    clearTimeout(g.timer);
    g.timer = window.setTimeout(() => this.endGesture(true), GESTURE_SETTLE_MS);
  }

  private endGesture(render: boolean): void {
    if (!this.gesture) return;
    clearTimeout(this.gesture.timer);
    this.gesture = null;
    if (render) this.drawNow();
  }

  /** One frame of a gesture: the snapshot, moved and scaled by the camera's change since it was taken. */
  private drawGestureFrame(): void {
    const g = this.gesture;
    if (!g || !this.snapCanvas || !this.viewport.width) return;
    const { ctx, camera, viewport, dpr } = this;
    const s = camera.zoom / g.cam.zoom;
    const tx = (viewport.width / 2) * (1 - s) - (camera.x - g.cam.x) * camera.zoom;
    const ty = (viewport.height / 2) * (1 - s) - (camera.y - g.cam.y) * camera.zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.ocean;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);
    ctx.drawImage(this.snapCanvas, 0, 0, viewport.width, viewport.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.callbacks.onCameraChange?.(this.scale);
  }

  private pulseFrame(): Pulse | undefined {
    if (!this.pulseAt) return undefined;
    const t = (performance.now() - this.pulseAt.start) / PULSE_MS;
    if (t >= 1) {
      this.pulseAt = null;
      return undefined;
    }
    return { ux: this.pulseAt.ux, uy: this.pulseAt.uy, t };
  }

  /** Ask for a render: at most one per animation frame, however many events ask. */
  private draw = (): void => {
    if (!this.renderQueued) this.renderQueued = requestAnimationFrame(this.flush);
  };

  private flush = (): void => {
    this.renderQueued = 0;
    if (this.gesture) this.drawGestureFrame();
    else this.renderNow();
  };

  /** Render this frame now (already inside a frame callback, or a resize that must not flash). */
  private drawNow(): void {
    cancelAnimationFrame(this.renderQueued);
    this.flush();
  }

  private renderNow(): void {
    const pulse = this.pulseFrame(); // before the size guard, so a pulse can always end
    if (!this.viewport.width) return;
    const style: Style = this.compare
      ? {
          ...this.style,
          overlay: {
            path: this.compare.path,
            fill: 'rgba(232,163,61,.42)',
            stroke: '#F5CE86'
          }
        }
      : { ...this.style, overlay: null };
    render(this.renderContext, this.world, style, this.focus, this.uiFont, pulse);
    this.drawn = { ...this.camera };
    this.callbacks.onCameraChange?.(this.scale);
  }

  private emitCompare(): void {
    if (!this.compare) return;
    const [sx, sy] = [
      ...(() => {
        const wx = lonToX(this.compare.lon);
        const wy = latToY(this.compare.lat);
        return [wx, wy];
      })()
    ];
    const screen = this.worldPointToScreen(sx, sy);
    const over = pick(this.renderContext, this.world, screen[0], screen[1]);
    this.callbacks.onCompareMove?.(this.compare.feature, over === this.compare.feature ? null : over);
  }

  private worldPointToScreen(wx: number, wy: number): [number, number] {
    let dx = wx - wrapX(this.camera.x);
    dx -= Math.round(dx);
    return [
      dx * this.camera.zoom + this.viewport.width / 2,
      (wy - this.camera.y) * this.camera.zoom + this.viewport.height / 2
    ];
  }

  /* ---------------------------------------------------------------------- events */

  private onFocusStealer = (e: Event): void => {
    if (this.keepFocus && e.cancelable) e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (this.keepFocus) e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, [e.offsetX, e.offsetY]);

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const world = screenToWorld(this.camera, this.viewport, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      this.pinch = { distance: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: this.camera.zoom, world };
      this.drag = null;
      this.canvas.classList.remove('is-dragging');
      return;
    }

    if (this.compare && hitOverlay(this.renderContext, this.compare.path, e.offsetX, e.offsetY)) {
      this.compare.dragging = true;
      this.moved = false;
      return;
    }

    this.drag = { x: e.offsetX, y: e.offsetY, camX: this.camera.x, camY: this.camera.y };
    this.moved = false;
    this.canvas.classList.add('is-dragging');
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [e.offsetX, e.offsetY]);

    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const zoom = clampZoom(this.pinch.zoom * (distance / Math.max(this.pinch.distance, 1)), this.viewport);
      const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // hold the world point that started under the fingers' midpoint under it now
      this.camera = clamp(
        {
          zoom,
          x: this.pinch.world[0] - (mx - this.viewport.width / 2) / zoom,
          y: this.pinch.world[1] - (my - this.viewport.height / 2) / zoom
        },
        this.viewport
      );
      this.target = { ...this.camera };
      this.touchGesture();
      this.draw();
      return;
    }

    if (this.compare?.dragging) {
      const [wx, wy] = screenToWorld(this.camera, this.viewport, e.offsetX, e.offsetY);
      this.compare.lon = xToLon(wrapX(wx));
      this.compare.lat = yToLat(Math.max(0.001, Math.min(0.999, wy)));
      this.compare.path = ringsToPath(
        reprojectToTrueSize(this.compare.feature, this.compare.lon, this.compare.lat)
      );
      this.moved = true;
      this.draw();
      this.emitCompare();
      return;
    }

    if (this.drag) {
      const dx = (e.offsetX - this.drag.x) / this.camera.zoom;
      const dy = (e.offsetY - this.drag.y) / this.camera.zoom;
      if (Math.abs(e.offsetX - this.drag.x) + Math.abs(e.offsetY - this.drag.y) > DRAG_THRESHOLD_PX) {
        this.moved = true;
      }
      this.camera = clamp(
        { x: this.drag.camX - dx, y: this.drag.camY - dy, zoom: this.camera.zoom },
        this.viewport
      );
      this.target = { ...this.camera };
      if (this.moved) this.touchGesture();
      this.draw();
      return;
    }

    // There is no hover on a touch screen: a finger that isn't down isn't anywhere, and the
    // tooltip/highlight that hover drives would only flash under a tap. A tap selects instead.
    if (e.pointerType === 'touch') return;
    const mark = pickPlace(this.renderContext, this.world, this.style, e.offsetX, e.offsetY);
    const feature = mark?.feature ?? pick(this.renderContext, this.world, e.offsetX, e.offsetY);
    this.callbacks.onHover(feature, e.offsetX, e.offsetY, mark);
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    this.canvas.classList.remove('is-dragging');

    if (this.compare?.dragging) {
      this.compare.dragging = false;
      return;
    }
    if (this.drag && !this.moved) {
      // a capital's ring selects its COUNTRY — there is no city page, and an empty panel
      // is worse than nothing
      const touch = e.pointerType === 'touch';
      const mark = pickPlace(
        this.renderContext, this.world, this.style, e.offsetX, e.offsetY,
        touch ? TOUCH_HIT_RADIUS_PX : undefined
      );
      this.callbacks.onSelect(
        mark?.feature ??
          pick(this.renderContext, this.world, e.offsetX, e.offsetY, touch ? TOUCH_HIT_RADIUS_PX : undefined)
      );
    }
    this.drag = null;
  };

  private onPointerLeave = (): void => {
    this.callbacks.onHover(null, 0, 0);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const [wx, wy] = screenToWorld(this.camera, this.viewport, e.offsetX, e.offsetY);
    const sensitivity = e.deltaMode === 1 ? WHEEL_LINE_SENSITIVITY : WHEEL_SENSITIVITY;
    const zoom = this.camera.zoom * Math.exp(-e.deltaY * sensitivity);
    const zoomed = clamp({ ...this.camera, zoom }, this.viewport);
    // hold the point under the cursor still
    this.camera = clamp(
      {
        zoom: zoomed.zoom,
        x: wx - (e.offsetX - this.viewport.width / 2) / zoomed.zoom,
        y: wy - (e.offsetY - this.viewport.height / 2) / zoomed.zoom
      },
      this.viewport
    );
    this.target = { ...this.camera };
    this.touchGesture();
    this.draw();
  };

  private onDoubleClick = (e: MouseEvent): void => {
    const [wx, wy] = screenToWorld(this.camera, this.viewport, e.offsetX, e.offsetY);
    this.moveTo(clamp({ x: wx, y: wy, zoom: this.camera.zoom * 2.1 }, this.viewport), true);
  };
}
