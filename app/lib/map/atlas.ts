/**
 * Binds the renderer to a canvas: owns the camera, the animation loop, and every pointer
 * interaction. Deliberately framework-free — React only tells it what to draw and listens
 * for hover and click.
 */
import {
  clamp, frame, homeCamera, homeZoom, screenToWorld, settled, shortestX, step,
  type CameraState, type Viewport
} from './camera';
import { lonToX, latToY, wrapX, xToLon, yToLat } from './projection';
import { hitOverlay, pick, render, scaleBar, type RenderContext, type Style } from './renderer';
import { reprojectToTrueSize, ringsToPath } from './topology';
import type { Feature, World } from './types';

export interface AtlasCallbacks {
  onHover(feature: Feature | null, x: number, y: number): void;
  onSelect(feature: Feature | null): void;
  onCameraChange?(scale: { km: number; px: number }): void;
  onCompareMove?(feature: Feature, over: Feature | null): void;
}

const DRAG_THRESHOLD_PX = 3;
const WHEEL_SENSITIVITY = 0.0016;
const WHEEL_LINE_SENSITIVITY = 0.05;

export class Atlas {
  private ctx: CanvasRenderingContext2D;
  private viewport: Viewport = { width: 0, height: 0 };
  private dpr = 1;
  private camera: CameraState = { x: 0.5, y: 0.46, zoom: 1 };
  private target: CameraState = { x: 0.5, y: 0.46, zoom: 1 };
  private animating = false;
  private frameHandle = 0;

  private style: Style;
  private focus = new Set<Feature>();
  private uiFont = 'system-ui, sans-serif';

  private drag: { x: number; y: number; camX: number; camY: number } | null = null;
  private moved = false;
  private pointers = new Map<number, [number, number]>();
  private pinch: { distance: number; zoom: number } | null = null;

  private compare: { feature: Feature; lon: number; lat: number; path: Path2D; dragging: boolean } | null = null;

  private resizeObserver: ResizeObserver;

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
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
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

  setUiFont(font: string): void {
    this.uiFont = font;
  }

  home(animate = true): void {
    this.moveTo(homeCamera(this.viewport), animate);
  }

  zoomBy(factor: number): void {
    this.moveTo(clamp({ ...this.target, zoom: this.target.zoom * factor }, this.viewport), true);
  }

  flyTo(feature: Feature, padding = 0.55): void {
    if (!feature.bbox) {
      this.moveTo(
        clamp({ x: feature.ux, y: feature.uy, zoom: homeZoom(this.viewport) * 34 }, this.viewport),
        true
      );
      return;
    }
    const [minLon, minLat, maxLon, maxLat] = feature.bbox;
    this.moveTo(
      frame(
        { x0: lonToX(minLon), x1: lonToX(maxLon), y0: latToY(maxLat), y1: latToY(minLat) },
        this.viewport,
        padding
      ),
      true
    );
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
      frame({ x0, x1, y0: Math.min(...ys), y1: Math.max(...ys) }, this.viewport, padding, 12),
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
    this.viewport = { width: rect.width, height: rect.height };
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    if (this.camera.zoom <= 1) {
      this.camera = homeCamera(this.viewport);
      this.target = { ...this.camera };
    } else {
      this.camera = clamp(this.camera, this.viewport);
      this.target = clamp(this.target, this.viewport);
    }
    this.draw();
  }

  private moveTo(next: CameraState, animate: boolean): void {
    this.target = clamp({ ...next, x: shortestX(this.camera.x, next.x) }, this.viewport);
    if (!animate) {
      this.camera = { ...this.target, x: wrapX(this.target.x) };
      this.target = { ...this.camera };
      this.draw();
      return;
    }
    if (this.animating) return;
    this.animating = true;
    const tick = () => {
      this.camera = clamp(step(this.camera, this.target), this.viewport);
      if (settled(this.camera, this.target)) {
        const x = wrapX(this.target.x);
        this.camera = { ...this.target, x };
        this.target = { ...this.camera };
        this.animating = false;
        this.draw();
        return;
      }
      this.draw();
      this.frameHandle = requestAnimationFrame(tick);
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  private draw = (): void => {
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
    render(this.renderContext, this.world, style, this.focus, this.uiFont);
    this.callbacks.onCameraChange?.(this.scale);
  };

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

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, [e.offsetX, e.offsetY]);

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { distance: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: this.camera.zoom };
      this.drag = null;
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
      this.camera = clamp(
        { ...this.camera, zoom: this.pinch.zoom * (distance / this.pinch.distance) },
        this.viewport
      );
      this.target = { ...this.camera };
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
      this.draw();
      return;
    }

    const feature = pick(this.renderContext, this.world, e.offsetX, e.offsetY);
    this.callbacks.onHover(feature, e.offsetX, e.offsetY);
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
      this.callbacks.onSelect(pick(this.renderContext, this.world, e.offsetX, e.offsetY));
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
    this.draw();
  };

  private onDoubleClick = (e: MouseEvent): void => {
    const [wx, wy] = screenToWorld(this.camera, this.viewport, e.offsetX, e.offsetY);
    this.moveTo(clamp({ x: wx, y: wy, zoom: this.camera.zoom * 2.1 }, this.viewport), true);
  };
}
