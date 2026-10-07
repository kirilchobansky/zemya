/**
 * The GL map: the same MapController the canvas Atlas implements, drawn by MapLibre GL JS.
 *
 * This module is the ONLY importer of `maplibre-gl` and is itself only ever reached through
 * a dynamic import (engine.ts), so the library stays out of the first page load and the
 * prerender never touches it.
 *
 * What lives where:
 *   - shapes: our own vector tiles (public/data/geography/world.pmtiles, scripts/build/build-tiles.mjs),
 *     read through the `pmtiles` protocol — no tile server, nothing from outside;
 *   - colour, emphasis, pin/shape switching, halo strength: FEATURE STATE, written here from the
 *     app's Style callbacks (restyle) and from the camera (syncView) — geometry is never rebuilt;
 *   - labels, capitals: symbol layers; the per-frame "which ones" decision reuses the exact
 *     predicates the canvas renderer used (visibility.ts), applied as a layer filter only when
 *     the set actually changes, so a pinch costs nothing in steady state;
 *   - camera: MapLibre's own (gestures, no inertia, easing, world copies). The app's camera maths
 *     (camera.ts, follow.ts) is unchanged: a CameraState {x, y, zoom} is converted to a centre and
 *     a map zoom (`zoom px = 512 * 2^z`), and a constrain callback keeps the old clamp rules.
 */
import type { GeoJSONSource, Map as GlMap } from 'maplibre-gl';

import {
  homeCamera, homeZoom, NO_INSETS, worldToScreen, type CameraState, type Insets, type Viewport
} from './camera';
import type { AtlasCallbacks, MapController } from './controller';
import { GlCamera } from './gl-camera';
import { GlCompare } from './gl-compare';
import { anchorPoints } from './gl-geo';
import { GlHover } from './gl-hover';
import type { GlHost } from './gl-host';
import { createGlMap } from './gl-setup';
import { pxToZoom, SOURCE } from './gl-style';
import { GlStyling } from './gl-styling';
import { GlViewSync } from './gl-view-sync';
import { xToLon, yToLat } from './projection';
import type { Style } from './style';
import type { Feature, PlaceMark, World } from './types';

const PULSE_MS = 1000;
const PULSE_START_RADIUS = 8;
const PULSE_GROWTH = 90;

export class GlAtlas implements MapController, GlHost {
  readonly map: GlMap;
  viewport: Viewport;
  insets: Insets = NO_INSETS;
  style: Style;
  destroyed = false;
  /** True once the style is in (set by create); gates syncView. */
  private ready = false;
  private focus = new Set<Feature>();

  private pulseHandle = 0;
  private resizeObserver: ResizeObserver;

  private styling: GlStyling;
  private viewSync: GlViewSync;
  private cam: GlCamera;
  private hover: GlHover;
  private compare: GlCompare;

  private constructor(
    readonly container: HTMLElement,
    readonly world: World,
    readonly callbacks: AtlasCallbacks,
    style: Style
  ) {
    this.style = style;

    const rect = container.getBoundingClientRect();
    this.viewport = { width: rect.width || 1000, height: rect.height || 600, insets: this.insets };
    const home = homeCamera(this.viewport, this.insets);

    this.styling = new GlStyling(this);
    this.map = createGlMap({ container, world, palette: this.styling.palette(), home, viewport: () => this.viewport });
    this.viewSync = new GlViewSync(this, this.styling);
    this.compare = new GlCompare(this);
    this.cam = new GlCamera(this, home, {
      userMoveStart: () => this.hover.clearHover(),
      afterMove: () => {
        this.syncView();
        if (this.hover.active) this.hover.emitHover();
      }
    });
    this.hover = new GlHover(this, {
      compareDragging: () => this.compare.dragging,
      easing: () => this.cam.easing,
      takeSuppressedClick: () => this.compare.takeSuppressedClick()
    });

    this.map.on('move', this.cam.onMove);
    this.map.on('movestart', this.cam.onMoveStart);
    this.map.on('moveend', this.cam.onMoveEnd);
    this.map.on('mousemove', this.hover.onMouseMove);
    this.map.on('click', this.hover.onClick);
    this.map.on('error', e => console.warn('[map]', e.error?.message ?? e));
    container.addEventListener('mouseleave', this.hover.onMouseLeave);
    container.addEventListener('pointerleave', this.hover.onMouseLeave);
    container.addEventListener('pointerup', this.hover.onPointerUp);
    container.addEventListener('pointercancel', this.hover.onPointerUp);
    window.addEventListener('blur', this.hover.onMouseLeave);
    container.addEventListener('mousedown', this.compare.onCaptureStart, true);
    container.addEventListener('touchstart', this.compare.onCaptureStart, { capture: true, passive: false });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  /** The camera as drawn right now, in the app's unit-square terms. */
  get camera(): CameraState {
    return this.cam.camera;
  }

  /** Builds the map and resolves once its style is in, with every country's state written. */
  static async create(container: HTMLElement, world: World, callbacks: AtlasCallbacks, style: Style): Promise<GlAtlas> {
    const atlas = new GlAtlas(container, world, callbacks, style);
    await new Promise<void>((resolve, reject) => {
      atlas.map.once('style.load', () => resolve());
      atlas.map.once('error', e => reject(e.error ?? new Error('map failed to load')));
    });
    atlas.ready = true;
    atlas.styling.installRingImage();
    atlas.styling.applyGraticuleRanges();
    atlas.restyle();
    atlas.syncView();
    return atlas;
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.pulseHandle);
    this.container.removeEventListener('mouseleave', this.hover.onMouseLeave);
    this.container.removeEventListener('pointerleave', this.hover.onMouseLeave);
    this.container.removeEventListener('pointerup', this.hover.onPointerUp);
    this.container.removeEventListener('pointercancel', this.hover.onPointerUp);
    window.removeEventListener('blur', this.hover.onMouseLeave);
    this.hover.clearHover();
    this.container.removeEventListener('mousedown', this.compare.onCaptureStart, true);
    this.container.removeEventListener('touchstart', this.compare.onCaptureStart, true);
    this.compare.destroy();
    this.map.remove();
  }

  /* ----------------------------------------------------------------- public API */

  setStyle(style: Style): void {
    this.style = style;
    this.restyle();
    this.syncView();
  }

  setFocus(features: Iterable<Feature>): void {
    this.focus = new Set(features);
    this.restyle();
  }

  setKeepFocus(keep: boolean): void {
    this.compare.setKeepFocus(keep);
  }

  setUiFont(font: string): void {
    this.viewSync.setUiFont(font);
  }

  /** The world's data or the theme changed under the map: re-read the palette, the anchors,
   *  the colours, and place everything again. */
  redraw(): void {
    this.styling.applyPalette();
    this.styling.installRingImage();
    (this.map.getSource(SOURCE.points) as GeoJSONSource | undefined)?.setData(anchorPoints(this.world));
    this.restyle();
    this.syncView();
  }

  setRegionView(box: [number, number, number, number] | null): void {
    this.cam.setRegionView(box);
  }

  setInsets(insets: Insets): void {
    this.insets = insets;
    this.viewport = { ...this.viewport, insets };
  }

  home(animate = true): void {
    this.cam.home(animate);
  }

  zoomBy(factor: number): void {
    this.cam.zoomBy(factor);
  }

  flyTo(feature: Feature, padding = 0.55): void {
    this.cam.flyTo(feature, padding);
  }

  /** The quiz camera's one decision — see Atlas#followTarget (atlas.ts), which this mirrors
   *  line for line: follow.ts decides, and only a result that differs from where the camera
   *  is HEADING moves it. */
  followTarget(request: { feature: Feature; place?: PlaceMark | null }, insets: Insets): void {
    this.cam.followTarget(request, insets);
  }

  pulse(ux: number, uy: number): void {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    cancelAnimationFrame(this.pulseHandle);
    (this.map.getSource(SOURCE.pulse) as GeoJSONSource).setData({
      type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [xToLon(ux), yToLat(uy)] }
    });
    const start = performance.now();
    const tick = () => {
      if (this.destroyed) return;
      const t = (performance.now() - start) / PULSE_MS;
      const eased = 1 - Math.pow(1 - t, 3);
      if (t >= 1) {
        this.map.setPaintProperty('pulse', 'circle-stroke-opacity', 0);
        return;
      }
      this.map.setPaintProperty('pulse', 'circle-radius', PULSE_START_RADIUS + PULSE_GROWTH * eased);
      this.map.setPaintProperty('pulse', 'circle-stroke-width', 3.5 - 2 * t);
      this.map.setPaintProperty('pulse', 'circle-stroke-opacity', 0.9 * (1 - t));
      this.pulseHandle = requestAnimationFrame(tick);
    };
    tick();
  }

  get view(): { x: number; y: number; zoom: number; home: number } {
    return { ...this.camera, home: homeZoom(this.viewport) };
  }

  screenPosition(ux: number, uy: number): [number, number] {
    return worldToScreen(this.camera, this.viewport, ux, uy);
  }

  fit(features: Feature[], padding = 0.6): void {
    this.cam.fit(features, padding);
  }

  startCompare(feature: Feature): boolean {
    return this.compare.startCompare(feature);
  }

  stopCompare(): void {
    this.compare.stopCompare();
  }

  get comparing(): Feature | null {
    return this.compare.comparing;
  }

  get scale(): { km: number; px: number } {
    return this.cam.scale;
  }

  clearHover(): void {
    this.hover.clearHover();
  }

  private restyle(): void {
    this.styling.restyle(this.focus);
  }

  /** What depends on the camera (see GlViewSync). `ready`, not isStyleLoaded(): that is false
   *  while any tile is still loading, which would skip the update on exactly the moves where
   *  labels must follow the zoom. */
  private syncView(): void {
    if (this.destroyed || !this.ready) return;
    this.viewSync.sync();
  }

  private resize(): void {
    if (this.destroyed) return;
    const rect = this.container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const before = homeCamera(this.viewport, this.insets).zoom;
    const wasHome = Math.abs(this.camera.zoom / before - 1) < 1e-3;
    this.viewport = { width: rect.width, height: rect.height, insets: this.insets };
    this.map.resize();
    // Resizing clears the canvas, and MapLibre repaints on the NEXT frame: while a sidebar is dragged
    // that is a black flash every frame. Painting synchronously, after the camera is settled below,
    // puts the picture back before the browser presents.
    const home = homeZoom(this.viewport);
    this.map.setMinZoom(pxToZoom(home * 0.78));
    this.map.setMaxZoom(pxToZoom(home * 320));
    this.styling.applyGraticuleRanges();
    if (wasHome) this.home(false);
    this.syncView();
    (this.map as unknown as { _render?: (t: number) => void })._render?.(performance.now());
  }
}
