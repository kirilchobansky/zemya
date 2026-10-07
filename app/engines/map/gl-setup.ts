/**
 * Creating the MapLibre map: the one-time global setup (worker, protocols), the style and
 * constructor options, momentum switched off, the collapsed attribution control and the
 * test seam. GlAtlas (gl-atlas.ts) owns everything after that.
 */
import { AttributionControl, LngLat, Map as GlMap, addProtocol, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import latin400 from '@fontsource/archivo/files/archivo-latin-400-normal.woff2?url';
import latin500 from '@fontsource/archivo/files/archivo-latin-500-normal.woff2?url';
import latinExt400 from '@fontsource/archivo/files/archivo-latin-ext-400-normal.woff2?url';
import latinExt500 from '@fontsource/archivo/files/archivo-latin-ext-500-normal.woff2?url';
import { PMTiles, Protocol } from 'pmtiles';

import { clampY, clampZoom, homeZoom, type CameraState, type Viewport } from './camera';
import { anchorPoints, capitalPoints, graticule } from './gl-geo';
import { buildStyle, pxToZoom, zoomToPx, type GlPalette } from './gl-style';
import { latToY, xToLon, yToLat } from './projection';
import { fetchArchive, MemorySource, TILES_URL } from './pmtiles-archive';
import type { World } from './types';

const ATTRIBUTION =
  'Shapes: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (public domain) · ' +
  'country data: <a href="https://github.com/mledoze/countries">mledoze/countries</a> (ODbL-1.0)';

/** Glyph ranges each self-hosted Archivo file covers (the Latin and Latin Extended subsets). */
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const split = (ranges: string) => ranges.split(',');

let initialised = false;
let protocol: Protocol | null = null;
/** One-time global setup: where MapLibre's worker lives once bundled, and our two protocols. */
function initOnce(): void {
  if (initialised) return;
  initialised = true;
  setWorkerUrl(workerUrl);
  protocol = new Protocol();
  addProtocol('pmtiles', protocol.tile);
  // The style spec wants a glyphs URL once any layer has text. Every glyph comes from the
  // self-hosted font files (`font-faces`), so this only has to answer "nothing here" — and
  // keeps a request for an uncovered character off the network.
  addProtocol('zemya-glyphs', async () => ({ data: new ArrayBuffer(0) }));
}

const tilesKey = () => new URL(TILES_URL, window.location.origin).href;
let tilesPending: Promise<void> | null = null;

/** Downloads world.pmtiles once (validated, pmtiles-archive.ts) and hands it to the `pmtiles`
 *  protocol from memory. Must resolve before a map is built; a failure is retried by the caller. */
export function prepareTiles(): Promise<void> {
  initOnce();
  tilesPending ??= fetchArchive().then(
    bytes => { protocol?.add(new PMTiles(new MemorySource(tilesKey(), bytes))); },
    error => { tilesPending = null; throw error; }
  );
  return tilesPending;
}

type StateValue = string | number | boolean;
/** Which feature-state keys belong to which source (so a pin colour is not also sent to the land). */

export interface GlMapOptions {
  container: HTMLElement;
  world: World;
  palette: GlPalette;
  home: CameraState;
  /** The live viewport (it changes on resize): the app's clamp reads it on every constrain. */
  viewport: () => Viewport;
}

/** No glide after a drag, pinch or flick, and no smoothing of wheel steps: the camera stops
 *  where the input stopped. MapLibre exposes neither switch (zoom inertia is hardcoded and
 *  pan's `maxSpeed` leaves the zoom path alone), so the two internals are replaced; both are
 *  guarded, and without them the map only keeps its default feel. Programmatic easeTo is untouched. */
function disableMomentum(map: GlMap): void {
  const internals = map as unknown as {
    handlers?: { _inertia?: { _onMoveEnd?: () => unknown } };
    scrollZoom?: { _smoothOutEasing?: () => (t: number) => number };
  };
  const inertia = internals.handlers?._inertia;
  if (inertia && typeof inertia._onMoveEnd === 'function') inertia._onMoveEnd = () => undefined;
  const wheel = internals.scrollZoom;
  if (wheel && typeof wheel._smoothOutEasing === 'function') wheel._smoothOutEasing = () => () => 1;
}

export function createGlMap({ container, world, palette, home, viewport }: GlMapOptions): GlMap {
  initOnce();
  const homePx = homeZoom(viewport());
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const map = new GlMap({
    container,
    style: buildStyle({
      palette,
      tilesUrl: `pmtiles://${tilesKey()}`,
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
    minZoom: pxToZoom(clampZoom(0, viewport())),
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
      const z = clampZoom(zoomToPx(zoom), viewport());
      const y = clampY(latToY(center.lat), z, viewport());
      return { center: new LngLat(center.lng, yToLat(y)), zoom: pxToZoom(z) };
    }
  } as ConstructorParameters<typeof GlMap>[0]);
  map.touchZoomRotate.disableRotation();
  disableMomentum(map);
  map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
  // collapsed behind its (i) button: the credit is one tap away, and out of the way of the HUD
  container.querySelector('.maplibregl-ctrl-attrib')?.removeAttribute('open');
  container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  // Test seam for tests/e2e/smoke.mjs and tests/e2e/perf.mjs: always in dev, in a production build only
  // for a page whose init script set `__ZEMYA_PROBE__` first (nothing a visitor ever does).
  const probe = window as unknown as { __zemyaGl?: GlMap; __ZEMYA_PROBE__?: boolean };
  if (import.meta.env.DEV || probe.__ZEMYA_PROBE__) probe.__zemyaGl = map;
  return map;
}
