/** Reading the map: the MapLibre instance's feature state and rendered features, never pixels. */
import { frames, mapIdle } from './waits.mjs';

/** The map host: the element MapLibre owns (it adds `maplibregl-map`; React's state classes live on
 *  its `.stage__canvas` wrapper). Not `.stage__canvas` alone — the history timeline's <canvas>
 *  shares that class. */
export const MAP = 'div.stage__map[aria-label="World map"]';

/** The map host's MapLibre-owned class and the layout it gives: all must survive React re-renders. */
export const hostStyle = page =>
  page.evaluate(sel => {
    const el = document.querySelector(sel);
    const css = getComputedStyle(el);
    return { hasClass: el.classList.contains('maplibregl-map'), overflow: css.overflow, position: css.position };
  }, MAP);

/** The map's centre as [lat, lon]. */
export const centreLatLon = page =>
  page.evaluate(() => { const c = window.__zemyaGl.getCenter(); return [c.lat, c.lng]; });

/** The feature state the renderer holds for one country: { c: fill colour, sc, sw, hide, ... }. */
export function countryState(page, iso3) {
  return page.evaluate(
    id => window.__zemyaGl.getFeatureState({ source: 'world', sourceLayer: 'countries', id }),
    iso3
  );
}

/** ISO3 codes of the country polygons actually rendered under a page (CSS) coordinate. */
export function renderedAt(page, x, y) {
  return page.evaluate(([px, py]) => {
    const map = window.__zemyaGl;
    const rect = map.getCanvas().getBoundingClientRect();
    return map.queryRenderedFeatures([px - rect.left, py - rect.top], { layers: ['countries'] })
      .map(f => f.id ?? f.properties.iso3);
  }, [x, y]);
}

/** Page (CSS) coordinates of a lon/lat under the current camera. */
export function pagePointOf(page, lon, lat) {
  return page.evaluate(([lo, la]) => {
    const map = window.__zemyaGl;
    const rect = map.getCanvas().getBoundingClientRect();
    const p = map.project([lo, la]);
    return [rect.left + p.x, rect.top + p.y];
  }, [lon, lat]);
}

/** The first of `points` with a country rendered under it, as { point, iso3 } — or null. */
export async function firstLand(page, points) {
  for (const point of points) {
    const hit = await renderedAt(page, point[0], point[1]);
    if (hit.length) return { point, iso3: hit[0] };
  }
  return null;
}

/** The camera as the app reports it ({ x, y, zoom, home }), once a quiz page has mounted. */
export const view = page => page.evaluate(() => window.__zemyaView());

/** Waits until the camera stops moving, then returns it. */
export async function settledCamera(page) {
  await mapIdle(page);
  return (await view(page)).camera;
}

/** "rgba(232,163,61,1)" / "#e8a33d" -> [r, g, b]. */
export function rgbOf(colour) {
  if (typeof colour !== 'string') return null;
  const hex = colour.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16));
  const rgb = colour.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/** The selection colour as the page's theme defines it (--brass differs between the themes). */
export const selectedColour = page =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brass').trim());

/** Whether two CSS colours are within `tolerance` per channel. */
export function sameColour(a, b, tolerance = 12) {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return Boolean(x && y) && x.every((c, i) => Math.abs(c - y[i]) <= tolerance);
}

/**
 * Wheel-zooms the map about its visible centre until the camera is at least `ratio` times
 * `from` (default: the home zoom), then waits for the camera to settle. The wheel-to-zoom
 * mapping is MapLibre's, so the loop adapts to it instead of assuming an exponent.
 */
export async function wheelZoom(page, ratio, { from = null } = {}) {
  const box = await page.locator(MAP).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const start = (await view(page)).camera;
  const goal = (from ?? start.home) * ratio;
  for (let i = 0; i < 80; i++) {
    if ((await view(page)).camera.zoom >= goal) break;
    await page.mouse.wheel(0, -120);
    await frames(page, 2);
  }
  return settledCamera(page);
}

/** After a navigation to a country: waits until the camera has left the world view (the scale bar
 *  no longer reads 10,000 km — the fly-to starts a tick after the page is quiet) and then until it
 *  is idle. A page that never flies times out here rather than passing on a premature "idle". */
export async function flewToCountry(page) {
  await page.waitForFunction(() => !/10,000 km/.test(document.querySelector('.scalebar')?.textContent ?? '10,000 km'), null, { timeout: 10000 }).catch(() => {});
  await mapIdle(page);
}
