/**
 * The GL map: the same MapController the canvas Atlas implements, drawn by MapLibre GL JS.
 *
 * This module is the ONLY importer of `maplibre-gl` and is itself only ever reached through
 * a dynamic import (engine.ts), so the library stays out of the first page load and the
 * prerender never touches it.
 *
 * What lives where:
 *   - shapes: our own vector tiles (public/data/geography/world.pmtiles, scripts/build-tiles.mjs),
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
import type { FeatureCollection } from 'geojson';
import {
  AttributionControl, LngLat, Map as GlMap, addProtocol, setWorkerUrl,
  type GeoJSONSource, type MapMouseEvent, type MapTouchEvent
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import latin400 from '@fontsource/archivo/files/archivo-latin-400-normal.woff2?url';
import latin500 from '@fontsource/archivo/files/archivo-latin-500-normal.woff2?url';
import latinExt400 from '@fontsource/archivo/files/archivo-latin-ext-400-normal.woff2?url';
import latinExt500 from '@fontsource/archivo/files/archivo-latin-ext-500-normal.woff2?url';
import { Protocol } from 'pmtiles';

import {
  centreInVisible, clamp, clampY, clampZoom, frame, homeCamera, homeZoom, NO_INSETS, scaleBar,
  shortestX, worldToScreen, type CameraState, type Insets, type Viewport
} from './camera';
import type { AtlasCallbacks, MapController } from './controller';
import { cameraForTarget, mainlandBox, NO_SHAPE_ZOOM_FACTOR, QUIZ_EDGE_MARGIN_PX, QUIZ_PIN_MARGIN_PX, QUIZ_POINT_MARGIN_PX, quizMinTargetPx, QUIZ_WORLD_VIEW_FACTOR, type FollowTarget } from './follow';
import { anchorPoints, capitalPoints, EMPTY, graticule, GRATICULE_STEPS, outlineFeature } from './gl-geo';
import {
  buildLayers, buildStyle, CAPITAL_RING_IMAGE, FILTERED_LAYERS, LAYER, NONE, pxToZoom, SOURCE, zoomToPx, type GlPalette
} from './gl-style';
import { latToY, lonToX, wrapX, xToLon, yToLat } from './projection';
import { COLORS, microMode, type Style } from './style';
import { CAPITAL_RING_HALO, CAPITAL_RING_RADIUS } from './thresholds';
import { reprojectPolygonsToTrueSize } from './topology';
import type { Feature, PlaceMark, World } from './types';
import {
  CAPITAL_PICK_RADIUS, capitalShapeShowing, capitalsVisible, drawsAsPin, haloAlpha, showsAsDot
} from './visibility';

const TILES_URL = '/data/geography/world.pmtiles';
const ATTRIBUTION =
  'Shapes: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (public domain) · ' +
  'country data: <a href="https://github.com/mledoze/countries">mledoze/countries</a> (ODbL-1.0)';

/** Glyph ranges each self-hosted Archivo file covers (the Latin and Latin Extended subsets). */
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const split = (ranges: string) => ranges.split(',');

/** How long a camera animation (fly-to, home, quiz follow) takes. */
const EASE_MS = 750;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const PULSE_MS = 1000;
const PULSE_START_RADIUS = 8;
const PULSE_GROWTH = 90;
/** A finger is imprecise: a pin or capital ring is drawn at 4-9 px but hit from a 24 px radius. */
const TOUCH_HIT_RADIUS_PX = 24;
const PIN_PICK_RADIUS = 9;
/** Minimum on-screen width before a country is worth naming (as the canvas renderer had it). */
const LABEL_MIN_WIDTH = 46;
const LABEL_ZOOM_FACTOR = 1.4;
const TRANSPARENT = 'rgba(0,0,0,0)';

let initialised = false;
/** One-time global setup: where MapLibre's worker lives once bundled, and our two protocols. */
function initOnce(): void {
  if (initialised) return;
  initialised = true;
  setWorkerUrl(workerUrl);
  const protocol = new Protocol();
  addProtocol('pmtiles', protocol.tile);
  // The style spec wants a glyphs URL once any layer has text. Every glyph comes from the
  // self-hosted font files (`font-faces`), so this only has to answer "nothing here" — and
  // keeps a request for an uncovered character off the network.
  addProtocol('zemya-glyphs', async () => ({ data: new ArrayBuffer(0) }));
}

type StateValue = string | number | boolean;
/** Which feature-state keys belong to which source (so a pin colour is not also sent to the land). */
const COUNTRY_KEYS = ['c', 'hide', 'sc', 'sw'];
const PIN_KEYS = ['pc', 'fo', 'dot'];
const HALO_KEYS = ['pc', 'halo'];

interface CompareState {
  feature: Feature;
  lon: number;
  lat: number;
  dragging: boolean;
  moved: boolean;
}

export class GlAtlas implements MapController {
  private map: GlMap;
  private viewport: Viewport;
  private insets: Insets = NO_INSETS;
  private target: CameraState;
  /** True from the moment our own easeTo starts until it ends (or a gesture interrupts it). */
  private ownEase = false;
  /** True once the style is in (set by create); gates syncView. */
  private ready = false;
  /** The hovered country / ring and the last report made for it (see emitHover). */
  private hoverFeature: Feature | null = null;
  private hoverMark: PlaceMark | null = null;
  private hoverKey = '';
  private style: Style;
  private focus = new Set<Feature>();
  private uiFont = 'system-ui, sans-serif';
  private keepFocus = false;
  private regionView: [number, number, number, number] | null = null;

  /** Last feature-state written per country, so only changes reach MapLibre. */
  private applied = new Map<string, Record<string, StateValue>>();
  /** Last filter key per filtered layer, so setFilter runs only when a set changes. */
  private filterKeys = new Map<string, string>();
  private quizPlaceKey = '';
  private lastScale = { km: 0, px: 0 };
  private graticuleHome = 0;
  private lastBorder = '';

  private compare: CompareState | null = null;
  private compareFrame = 0;
  private suppressClick = false;

  private pulseHandle = 0;
  private resizeObserver: ResizeObserver;
  private widths = new Map<string, number>();
  private measureCtx: CanvasRenderingContext2D | null = null;
  private destroyed = false;

  private constructor(
    private container: HTMLElement,
    private world: World,
    private callbacks: AtlasCallbacks,
    style: Style
  ) {
    initOnce();
    this.style = style;

    const rect = container.getBoundingClientRect();
    this.viewport = { width: rect.width || 1000, height: rect.height || 600, insets: this.insets };
    const home = homeCamera(this.viewport, this.insets);
    this.target = home;
    const homePx = homeZoom(this.viewport);

    const palette = this.palette();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.map = new GlMap({
      container,
      style: buildStyle({
        palette,
        tilesUrl: `pmtiles://${new URL(TILES_URL, window.location.origin).href}`,
        attribution: ATTRIBUTION,
        fonts: {
          Archivo: [{ url: latin400, unicodeRange: LATIN }, { url: latinExt400, unicodeRange: LATIN_EXT }],
          'Archivo Medium': [{ url: latin500, unicodeRange: LATIN }, { url: latinExt500, unicodeRange: LATIN_EXT }]
        },
        glyphsUrl: 'zemya-glyphs://{fontstack}/{range}.pbf',
        geo: { points: anchorPoints(world), capitals: capitalPoints(world), graticule: graticule() }
      }),
      center: [xToLon(home.x), yToLat(home.y)],
      zoom: pxToZoom(home.zoom),
      minZoom: pxToZoom(clampZoom(0, this.viewport)),
      maxZoom: pxToZoom(homePx * 320),
      renderWorldCopies: true,
      pitch: 0,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      keyboard: false,
      attributionControl: false,
      fadeDuration: 0, // labels and icons vanish the frame they should, never fade out
      pixelRatio: dpr,
      trackResize: false,
      canvasContextAttributes: { antialias: true },
      // the app's own clamp (camera.ts): vertical limits that respect what covers the map, and
      // the zoom range — MapLibre's default would zoom in until the world fills the screen
      transformConstrain: (center: LngLat, zoom: number) => {
        const z = clampZoom(zoomToPx(zoom), this.viewport);
        const y = clampY(latToY(center.lat), z, this.viewport);
        return { center: new LngLat(center.lng, yToLat(y)), zoom: pxToZoom(z) };
      }
    } as ConstructorParameters<typeof GlMap>[0]);
    this.map.touchZoomRotate.disableRotation();
    this.disableMomentum();
    this.map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    // collapsed behind its (i) button: the credit is one tap away, and out of the way of the HUD
    container.querySelector('.maplibregl-ctrl-attrib')?.removeAttribute('open');
    container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    // Test seam for test/smoke.mjs and test/perf.mjs: always in dev, in a production build only
    // for a page whose init script set `__ZEMYA_PROBE__` first (nothing a visitor ever does).
    const probe = window as unknown as { __zemyaGl?: GlMap; __ZEMYA_PROBE__?: boolean };
    if (import.meta.env.DEV || probe.__ZEMYA_PROBE__) probe.__zemyaGl = this.map;

    this.map.on('move', this.onMove);
    this.map.on('movestart', this.onMoveStart);
    this.map.on('moveend', this.onMoveEnd);
    this.map.on('mousemove', this.onMouseMove);
    this.map.on('click', this.onClick);
    this.map.on('error', e => console.warn('[map]', e.error?.message ?? e));
    container.addEventListener('mouseleave', this.onMouseLeave);
    container.addEventListener('mousedown', this.onCaptureStart, true);
    container.addEventListener('touchstart', this.onCaptureStart, { capture: true, passive: false });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  /** No glide after a drag, pinch or flick, and no smoothing of wheel steps: the camera stops
   *  where the input stopped. MapLibre exposes neither switch (zoom inertia is hardcoded and
   *  pan's `maxSpeed` leaves the zoom path alone), so the two internals are replaced; both are
   *  guarded, and without them the map only keeps its default feel. Programmatic easeTo is untouched. */
  private disableMomentum(): void {
    const internals = this.map as unknown as {
      handlers?: { _inertia?: { _onMoveEnd?: () => unknown } };
      scrollZoom?: { _smoothOutEasing?: () => (t: number) => number };
    };
    const inertia = internals.handlers?._inertia;
    if (inertia && typeof inertia._onMoveEnd === 'function') inertia._onMoveEnd = () => undefined;
    const wheel = internals.scrollZoom;
    if (wheel && typeof wheel._smoothOutEasing === 'function') wheel._smoothOutEasing = () => () => 1;
  }

  /** Builds the map and resolves once its style is in, with every country's state written. */
  static async create(container: HTMLElement, world: World, callbacks: AtlasCallbacks, style: Style): Promise<GlAtlas> {
    const atlas = new GlAtlas(container, world, callbacks, style);
    await new Promise<void>((resolve, reject) => {
      atlas.map.once('style.load', () => resolve());
      atlas.map.once('error', e => reject(e.error ?? new Error('map failed to load')));
    });
    atlas.ready = true;
    atlas.installRingImage();
    atlas.applyGraticuleRanges();
    atlas.restyle();
    atlas.syncView();
    return atlas;
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.pulseHandle);
    cancelAnimationFrame(this.compareFrame);
    this.container.removeEventListener('mouseleave', this.onMouseLeave);
    this.container.removeEventListener('mousedown', this.onCaptureStart, true);
    this.container.removeEventListener('touchstart', this.onCaptureStart, true);
    this.endCompareDrag();
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
    this.keepFocus = keep;
  }

  setUiFont(font: string): void {
    this.uiFont = font;
    this.widths.clear();
  }

  /** The world's data or the theme changed under the map: re-read the palette, the anchors,
   *  the colours, and place everything again. */
  redraw(): void {
    this.applyPalette();
    this.installRingImage();
    (this.map.getSource(SOURCE.points) as GeoJSONSource | undefined)?.setData(anchorPoints(this.world));
    this.restyle();
    this.syncView();
  }

  setRegionView(box: [number, number, number, number] | null): void {
    this.regionView = box;
  }

  setInsets(insets: Insets): void {
    this.insets = insets;
    this.viewport = { ...this.viewport, insets };
  }

  home(animate = true): void {
    this.moveTo(this.homeView(), animate);
  }

  zoomBy(factor: number): void {
    const heading = this.heading;
    this.moveTo(clamp({ ...heading, zoom: heading.zoom * factor }, this.viewport), true);
  }

  flyTo(feature: Feature, padding = 0.55): void {
    if (!feature.bbox) {
      const zoom = homeZoom(this.viewport) * NO_SHAPE_ZOOM_FACTOR;
      this.moveTo(clamp({ ...centreInVisible(feature.ux, feature.uy, zoom, this.insets), zoom }, this.viewport), true);
      return;
    }
    const [minLon, minLat, maxLon, maxLat] = feature.bbox;
    this.moveTo(
      frame({ x0: lonToX(minLon), x1: lonToX(maxLon), y0: latToY(maxLat), y1: latToY(minLat) }, this.viewport, padding, Infinity, this.insets),
      true
    );
  }

  /** The quiz camera's one decision — see Atlas#followTarget (atlas.ts), which this mirrors
   *  line for line: follow.ts decides, and only a result that differs from where the camera
   *  is HEADING moves it. */
  followTarget(request: { feature: Feature; place?: PlaceMark | null }, insets: Insets): void {
    const { feature, place } = request;
    const cam = this.heading;
    const home = this.homeView();
    const zoomedIn = cam.zoom > home.zoom * QUIZ_WORLD_VIEW_FACTOR;

    const minWidthPx = quizMinTargetPx(Boolean(place));
    const mainland = feature.halo
      ? { x0: feature.halo.x0, x1: feature.halo.x1, y0: feature.halo.y0, y1: feature.halo.y1 }
      : feature.bbox && (feature.path || feature.fullPath) ? mainlandBox(feature) : null;
    const reachable =
      mainland && (mainland.x1 - mainland.x0) * clampZoom(minWidthPx / Math.max(mainland.x1 - mainland.x0, 1e-9), this.viewport) >= minWidthPx * 0.999;
    const box = reachable ? mainland : null;
    const target: FollowTarget = place
      ? { box, focus: { x: place.ux, y: place.uy }, fit: false, marginPx: QUIZ_POINT_MARGIN_PX, minWidthPx }
      : box
        ? { box, focus: { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }, fit: true, marginPx: QUIZ_EDGE_MARGIN_PX, minWidthPx }
        : { box: null, focus: { x: feature.ux, y: feature.uy }, fit: false, marginPx: QUIZ_PIN_MARGIN_PX, minWidthPx };
    const options = { noShapeZoom: homeZoom(this.viewport) * NO_SHAPE_ZOOM_FACTOR };
    let base = cam;
    let next = cameraForTarget(base, this.viewport, insets, target, options);
    if (next && zoomedIn) {
      base = home;
      next = cameraForTarget(base, this.viewport, insets, target, options);
    }

    const dest = clamp(next ?? base, this.viewport);
    const now = clamp(cam, this.viewport);
    const moved =
      Math.abs(dest.zoom - now.zoom) > now.zoom * 1e-6 ||
      Math.abs(dest.x - now.x) > 1e-9 ||
      Math.abs(dest.y - now.y) > 1e-9;
    if (moved) this.moveTo(dest, true);
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
    this.moveTo(frame({ x0, x1, y0: Math.min(...ys), y1: Math.max(...ys) }, this.viewport, padding, 12, this.insets), true);
  }

  startCompare(feature: Feature): boolean {
    if (!feature.polygons.length) return false;
    const [lon, lat] = feature.anchor;
    this.compare = { feature, lon, lat, dragging: false, moved: false };
    this.drawCompare();
    this.emitCompare();
    return true;
  }

  stopCompare(): void {
    this.compare = null;
    this.endCompareDrag();
    (this.map.getSource(SOURCE.compare) as GeoJSONSource | undefined)?.setData(EMPTY);
  }

  get comparing(): Feature | null {
    return this.compare?.feature ?? null;
  }

  get scale(): { km: number; px: number } {
    return scaleBar(this.camera, this.viewport);
  }

  /* -------------------------------------------------------------------- camera */

  /** The camera as drawn right now, in the app's unit-square terms. */
  private get camera(): CameraState {
    const c = this.map.getCenter();
    return { x: lonToX(c.lng), y: latToY(c.lat), zoom: zoomToPx(this.map.getZoom()) };
  }

  /** Where the camera is HEADING: our own animation's destination while one runs, else where it is. */
  private get heading(): CameraState {
    return this.ownEase ? this.target : this.camera;
  }

  private homeView(): CameraState {
    if (!this.regionView) return homeCamera(this.viewport, this.insets);
    const [minLon, minLat, maxLon, maxLat] = this.regionView;
    return frame({ x0: lonToX(minLon), x1: lonToX(maxLon), y0: latToY(maxLat), y1: latToY(minLat) }, this.viewport, 0.85, Infinity, this.insets);
  }

  private moveTo(next: CameraState, animate: boolean): void {
    const target = clamp({ ...next, x: shortestX(this.camera.x, next.x) }, this.viewport);
    this.target = target;
    const center: [number, number] = [xToLon(target.x), yToLat(target.y)];
    const zoom = pxToZoom(target.zoom);
    if (!animate) {
      this.ownEase = false;
      this.map.jumpTo({ center, zoom });
      this.target = this.camera;
      return;
    }
    this.map.easeTo({ center, zoom, duration: EASE_MS, easing: easeOut, essential: true }, { zemya: true });
    this.ownEase = true; // after easeTo: starting it ends (and flags) whatever ran before
  }

  private resize(): void {
    if (this.destroyed) return;
    const rect = this.container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const before = homeCamera(this.viewport, this.insets).zoom;
    const wasHome = Math.abs(this.camera.zoom / before - 1) < 1e-3;
    this.viewport = { width: rect.width, height: rect.height, insets: this.insets };
    this.map.resize();
    const home = homeZoom(this.viewport);
    this.map.setMinZoom(pxToZoom(home * 0.78));
    this.map.setMaxZoom(pxToZoom(home * 320));
    this.applyGraticuleRanges();
    if (wasHome) this.home(false);
    this.syncView();
  }

  private onMoveStart = (e: object): void => {
    if (!(e as { zemya?: boolean }).zemya) {
      this.ownEase = false;
      this.target = this.camera;
    }
  };

  private onMove = (): void => {
    this.syncView();
    if (this.hoverFeature) this.emitHover();
    const scale = this.scale;
    if (scale.km !== this.lastScale.km || Math.round(scale.px) !== Math.round(this.lastScale.px)) {
      this.lastScale = scale;
      this.callbacks.onCameraChange?.(scale);
    }
  };

  private onMoveEnd = (e: object): void => {
    if ((e as { zemya?: boolean }).zemya) this.ownEase = false;
    if (!this.ownEase) this.target = this.camera;
  };

  /* --------------------------------------------------------------- feature state */

  private palette(): GlPalette {
    return { border: this.style.defaultStroke?.() ?? ['rgba(10,16,23,.92)', 1] };
  }

  /** Writes the changed keys of one country's state — to the sources that read them. */
  private patch(feature: Feature, values: Record<string, StateValue>): void {
    const id = feature.country.iso3;
    const prev = this.applied.get(id) ?? {};
    const changed: Record<string, StateValue> = {};
    let any = false;
    for (const key in values) {
      if (prev[key] !== values[key]) { changed[key] = values[key]; any = true; }
    }
    if (!any) return;
    this.applied.set(id, { ...prev, ...changed });
    const route = (keys: string[], target: { source: string; sourceLayer?: string; id: string }) => {
      const sub: Record<string, StateValue> = {};
      let has = false;
      for (const key of keys) if (key in changed) { sub[key] = changed[key]; has = true; }
      if (has) this.map.setFeatureState(target, sub);
    };
    route(COUNTRY_KEYS, { source: SOURCE.world, sourceLayer: 'countries', id });
    route(PIN_KEYS, { source: SOURCE.points, id });
    if (feature.halo) route(HALO_KEYS, { source: SOURCE.world, sourceLayer: 'halos', id });
  }

  /** Everything the app's Style decides: colours, borders, focus. */
  private restyle(): void {
    const style = this.style;
    const fallback = style.defaultStroke?.() ?? null;
    this.applyBorder(fallback);
    for (const feature of this.world.features) {
      const fill = style.fill(feature);
      const stroke = style.stroke(feature);
      const emphasised = stroke !== null && (!fallback || stroke[0] !== fallback[0] || stroke[1] !== fallback[1]);
      const focused = this.focus.has(feature);
      this.patch(feature, {
        c: fill ?? TRANSPARENT,
        pc: fill === null ? TRANSPARENT : fill === COLORS.land ? COLORS.microPin : fill,
        sc: emphasised ? stroke[0] : TRANSPARENT,
        sw: emphasised ? stroke[1] : 0,
        fo: style.quizMode && focused ? 2 : focused ? 1 : 0
      });
    }
  }

  private applyBorder(border: [string, number] | null): void {
    if (!border) return;
    const key = `${border[0]}|${border[1]}`;
    if (key === this.lastBorder) return;
    this.lastBorder = key;
    this.map.setPaintProperty('borders', 'line-color', border[0]);
    this.map.setPaintProperty('borders', 'line-width', border[1]);
  }

  /** Re-reads every palette colour into the static layers (a theme change). */
  private applyPalette(): void {
    const border = this.palette().border;
    this.lastBorder = '';
    for (const layer of buildLayers({ border })) {
      if (layer.id === 'pulse' || !('paint' in layer) || !layer.paint) continue;
      for (const [key, value] of Object.entries(layer.paint)) {
        this.map.setPaintProperty(layer.id, key as never, value as never);
      }
    }
    this.applied.clear(); // colours changed under every state: write them all again
  }

  /** The capital ring as an image: a dark halo under an ink ring, drawn once per theme. */
  private installRingImage(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const radius = CAPITAL_RING_RADIUS;
    const size = Math.ceil((radius + CAPITAL_RING_HALO + 2) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.round(size * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.lineWidth = CAPITAL_RING_HALO * 2;
    ctx.strokeStyle = COLORS.capitalHalo;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS.capital;
    ctx.stroke();
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (this.map.hasImage(CAPITAL_RING_IMAGE)) this.map.removeImage(CAPITAL_RING_IMAGE);
    this.map.addImage(CAPITAL_RING_IMAGE, image, { pixelRatio: ratio });
  }

  /** Each graticule step shows between two zooms, as multiples of the world-fills-the-view zoom. */
  private applyGraticuleRanges(): void {
    const home = homeZoom(this.viewport);
    if (home === this.graticuleHome) return;
    this.graticuleHome = home;
    const bounds = [0, 3, 10, 30]; // lower edge of each step, x home (30, 10, 5, 1 deg)
    GRATICULE_STEPS.forEach((step, i) => {
      const lo = i === 0 ? -2 : pxToZoom(home * bounds[i]);
      const hi = i === GRATICULE_STEPS.length - 1 ? 24 : pxToZoom(home * bounds[i + 1]);
      this.map.setLayerZoomRange(`graticule-${step}`, lo, hi);
    });
  }

  /* ----------------------------------------------------------------- per-camera */

  /** What depends on the camera: which countries are pins, halo strength, which names and
   *  capitals show. Each part writes only when its answer changed. */
  private syncView(): void {
    // `ready`, not isStyleLoaded(): that is false while any tile is still loading, which would
    // skip the update on exactly the moves where labels must follow the zoom
    if (this.destroyed || !this.ready) return;
    const { world, style, viewport } = this;
    const camera = this.camera;
    const micro = microMode(style);

    for (const feature of world.features) {
      this.patch(feature, {
        hide: drawsAsPin(feature, camera),
        dot: showsAsDot(feature, camera, micro),
        halo: micro === 'full' ? Math.round(haloAlpha(feature, camera) * 20) / 20 : 0
      });
    }

    // country names (largest claim first), then micro-state / island names beside their pin
    const countries: string[] = [];
    const micros: string[] = [];
    if (style.showLabels && !style.quizMode && camera.zoom >= homeZoom(viewport) * LABEL_ZOOM_FACTOR) {
      const named = new Set<Feature>();
      for (const feature of world.features) {
        if (!feature.bbox) continue;
        const widthPx = (lonToX(feature.bbox[2]) - lonToX(feature.bbox[0])) * camera.zoom;
        if (widthPx < LABEL_MIN_WIDTH) continue;
        const size = Math.round(Math.max(10, Math.min(14, widthPx / 7)));
        if (this.textWidth(feature.country.name, size) > widthPx * 1.05) continue;
        countries.push(feature.country.iso3);
        named.add(feature);
      }
      if (micro === 'full') {
        for (const feature of world.features) {
          if (!named.has(feature) && (drawsAsPin(feature, camera) || haloAlpha(feature, camera) > 0)) micros.push(feature.country.iso3);
        }
      }
    }
    this.setSet(LAYER.labelsCountry, countries);
    this.setSet(LAYER.labelsMicro, micros);

    // capitals: ring and name together, only while the layer is on and the country shows a shape
    const capitals = capitalsVisible(style, camera, viewport)
      ? world.places.filter(mark => capitalShapeShowing(mark, camera, viewport)).map(mark => mark.place.iso3)
      : [];
    this.setSet(LAYER.capitals, capitals);

    // the capitals quiz's target ring, unless its country is still drawn as a pin
    const quizPlace = style.quizMode && style.quizPlace && !drawsAsPin(style.quizPlace.feature, camera) ? style.quizPlace : null;
    const placeKey = quizPlace ? `${quizPlace.place.lon},${quizPlace.place.lat}` : '';
    if (placeKey !== this.quizPlaceKey) {
      this.quizPlaceKey = placeKey;
      (this.map.getSource(SOURCE.quizPlace) as GeoJSONSource).setData(
        quizPlace
          ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [quizPlace.place.lon, quizPlace.place.lat] } }
          : EMPTY
      );
    }
  }

  private setSet(layer: (typeof FILTERED_LAYERS)[number], iso3: string[]): void {
    const key = iso3.join();
    if (this.filterKeys.get(layer) === key) return;
    this.filterKeys.set(layer, key);
    this.map.setFilter(layer, (iso3.length ? ['in', ['get', 'iso3'], ['literal', iso3]] : NONE) as never);
  }

  private textWidth(text: string, size: number): number {
    const key = `${size}:${text}`;
    let width = this.widths.get(key);
    if (width === undefined) {
      this.measureCtx ??= document.createElement('canvas').getContext('2d');
      if (this.measureCtx) this.measureCtx.font = `500 ${size}px ${this.uiFont}`;
      width = this.measureCtx?.measureText(text).width ?? text.length * size * 0.55;
      this.widths.set(key, width);
    }
    return width;
  }

  /* ---------------------------------------------------------------- hit testing */

  /** Which country is under this screen point — the same order as the canvas version: pins
   *  (they sit on top), then real shapes, then an island nation's halo. */
  private pickAt(sx: number, sy: number, radius = PIN_PICK_RADIUS): Feature | null {
    const { world, viewport } = this;
    const camera = this.camera;
    const micro = microMode(this.style);

    let nearestPin: Feature | null = null;
    let nearest = radius;
    for (const feature of world.features) {
      if (!showsAsDot(feature, camera, micro)) continue;
      const [x, y] = worldToScreen(camera, viewport, feature.ux, feature.uy);
      const distance = Math.hypot(x - sx, y - sy);
      if (distance < nearest) { nearest = distance; nearestPin = feature; }
    }
    if (nearestPin) return nearestPin;

    for (const hit of this.map.queryRenderedFeatures([sx, sy], { layers: [LAYER.countries] })) {
      const feature = world.byIso3.get(String(hit.properties?.iso3));
      if (feature && !drawsAsPin(feature, camera)) return feature;
    }
    if (micro !== 'full') return null;
    const haloed = new Set<string>();
    for (const hit of this.map.queryRenderedFeatures([sx, sy], { layers: [LAYER.haloFill] })) haloed.add(String(hit.properties?.iso3));
    // smallest halo first, so the smaller country wins an overlap
    for (const feature of world.haloFeatures) {
      if (haloed.has(feature.country.iso3) && haloAlpha(feature, camera) > 0) return feature;
    }
    return null;
  }

  /** The capital ring under this point, if the layer shows one: a ring MapLibre did not place
   *  (no room for its name) is not in the query, so a ring you cannot see cannot be hit. */
  private pickPlaceAt(sx: number, sy: number, radius = CAPITAL_PICK_RADIUS): PlaceMark | null {
    const { world, viewport } = this;
    const camera = this.camera;
    if (!capitalsVisible(this.style, camera, viewport)) return null;
    const hits = this.map.queryRenderedFeatures(
      [[sx - radius, sy - radius], [sx + radius, sy + radius]], { layers: [LAYER.capitals] }
    );
    let nearest: PlaceMark | null = null;
    let nearestDistance = radius;
    for (const hit of hits) {
      const mark = world.places.find(m => m.place.iso3 === hit.properties?.iso3);
      if (!mark) continue;
      const [x, y] = worldToScreen(camera, viewport, mark.ux, mark.uy);
      const distance = Math.hypot(x - sx, y - sy);
      if (distance < nearestDistance) { nearestDistance = distance; nearest = mark; }
    }
    return nearest;
  }

  private static isTouch(event: MouseEvent | TouchEvent | PointerEvent): boolean {
    if ('pointerType' in event) return event.pointerType === 'touch';
    if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) return true;
    return Boolean((event as { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents);
  }

  private onMouseMove = (e: MapMouseEvent): void => {
    if (this.compare?.dragging) return;
    // a finger that is not down is not anywhere: hover is for a mouse
    if (GlAtlas.isTouch(e.originalEvent)) return;
    if (this.map.isMoving() && !this.ownEase) return; // dragging the map
    const { x, y } = e.point;
    const mark = this.pickPlaceAt(x, y);
    const feature = mark?.feature ?? this.pickAt(x, y);
    // moving within one country (or one ring) is not a change: no work, no callback
    if (feature === this.hoverFeature && mark === this.hoverMark) return;
    this.hoverFeature = feature;
    this.hoverMark = mark;
    this.hoverKey = '';
    this.emitHover();
  };

  private onMouseLeave = (): void => {
    this.hoverFeature = null;
    this.hoverMark = null;
    this.hoverKey = '';
    this.callbacks.onHover(null, 0, 0);
  };

  /** Reports the hover with the position of the country's own label point (its anchor, the
   *  point the Names layer uses) or the hovered ring — never the pointer. `labelShown` is
   *  whether MapLibre has placed that name, in which case the app shows no tooltip. Called on a
   *  change of country and, while one is hovered, when the camera moves the point; skipped when
   *  nothing it reports changed. */
  private emitHover(): void {
    const feature = this.hoverFeature;
    if (!feature) return;
    const mark = this.hoverMark;
    const at = mark ? this.map.project([mark.place.lon, mark.place.lat]) : this.map.project(feature.anchor as [number, number]);
    const x = Math.round(at.x);
    const y = Math.round(at.y);
    let labelShown = false;
    if (mark) labelShown = true; // a ring that can be hovered is drawn with its name
    else {
      labelShown = this.map.queryRenderedFeatures(
        [[x - 90, y - 14], [x + 90, y + 14]], { layers: [LAYER.labelsCountry, LAYER.labelsMicro] }
      ).some(hit => hit.properties?.iso3 === feature.country.iso3);
    }
    const key = `${x},${y},${labelShown}`;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.callbacks.onHover(feature, x, y, mark, labelShown);
  }

  private onClick = (e: MapMouseEvent | MapTouchEvent): void => {
    if (this.suppressClick) { this.suppressClick = false; return; }
    const touch = GlAtlas.isTouch(e.originalEvent as MouseEvent | TouchEvent);
    const { x, y } = e.point;
    // a capital's ring selects its COUNTRY — there is no city page
    const mark = this.pickPlaceAt(x, y, touch ? TOUCH_HIT_RADIUS_PX : undefined);
    this.callbacks.onSelect(mark?.feature ?? this.pickAt(x, y, touch ? TOUCH_HIT_RADIUS_PX : undefined));
  };

  /* ------------------------------------------------------------ the compare outline */

  /** Capture phase, before MapLibre's own handlers: keeps the keyboard where it is during a
   *  quiz run, and lets a drag that starts on the comparison outline move the outline, not the map. */
  private onCaptureStart = (e: MouseEvent | TouchEvent): void => {
    if (this.keepFocus && e.cancelable) e.preventDefault();
    if (!this.compare) return;
    const point = this.eventPoint(e);
    if (!point || !this.map.queryRenderedFeatures([point.x, point.y], { layers: [LAYER.compareFill] }).length) return;
    e.stopImmediatePropagation();
    this.compare.dragging = true;
    this.compare.moved = false;
    window.addEventListener('mousemove', this.onCompareMove);
    window.addEventListener('mouseup', this.onCompareEnd);
    window.addEventListener('touchmove', this.onCompareMove, { passive: false });
    window.addEventListener('touchend', this.onCompareEnd);
    window.addEventListener('touchcancel', this.onCompareEnd);
  };

  private eventPoint(e: MouseEvent | TouchEvent): { x: number; y: number } | null {
    const source = 'touches' in e ? e.touches[0] ?? e.changedTouches[0] : e;
    if (!source) return null;
    const rect = this.container.getBoundingClientRect();
    return { x: source.clientX - rect.left, y: source.clientY - rect.top };
  }

  private onCompareMove = (e: MouseEvent | TouchEvent): void => {
    if (!this.compare?.dragging) return;
    const point = this.eventPoint(e);
    if (!point) return;
    if (e.cancelable) e.preventDefault();
    const { lng, lat } = this.map.unproject([point.x, point.y]);
    this.compare.lon = xToLon(wrapX(lonToX(lng)));
    this.compare.lat = Math.max(-84, Math.min(84, lat));
    this.compare.moved = true;
    this.drawCompare();
    this.emitCompare();
  };

  private onCompareEnd = (): void => {
    if (this.compare?.moved) this.suppressClick = true; // the click that ends a drag selects nothing
    this.endCompareDrag();
  };

  private endCompareDrag(): void {
    if (this.compare) this.compare.dragging = false;
    window.removeEventListener('mousemove', this.onCompareMove);
    window.removeEventListener('mouseup', this.onCompareEnd);
    window.removeEventListener('touchmove', this.onCompareMove);
    window.removeEventListener('touchend', this.onCompareEnd);
    window.removeEventListener('touchcancel', this.onCompareEnd);
  }

  /** At most one geometry update per animation frame, however fast the pointer moves. */
  private drawCompare(): void {
    if (this.compareFrame) return;
    this.compareFrame = requestAnimationFrame(() => {
      this.compareFrame = 0;
      const compare = this.compare;
      if (!compare || this.destroyed) return;
      const data: FeatureCollection = {
        type: 'FeatureCollection',
        features: [outlineFeature(reprojectPolygonsToTrueSize(compare.feature, compare.lon, compare.lat))]
      };
      (this.map.getSource(SOURCE.compare) as GeoJSONSource).setData(data);
    });
  }

  private emitCompare(): void {
    if (!this.compare) return;
    const [sx, sy] = worldToScreen(this.camera, this.viewport, lonToX(this.compare.lon), latToY(this.compare.lat));
    const over = this.pickAt(sx, sy);
    this.callbacks.onCompareMove?.(this.compare.feature, over === this.compare.feature ? null : over);
  }
}
