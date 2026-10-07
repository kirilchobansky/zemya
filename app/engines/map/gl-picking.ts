/**
 * Hit testing for the GL map: which country (or capital ring) is under a screen point.
 */
import { worldToScreen } from './camera';
import type { GlHost } from './gl-host';
import { LAYER } from './gl-style';
import { microMode } from './style';
import type { Feature, PlaceMark } from './types';
import { CAPITAL_PICK_RADIUS, capitalsVisible, haloAlpha, landHidden, showsAsDot } from './visibility';

export const PIN_PICK_RADIUS = 9;

/** Which country is under this screen point — the same order as the canvas version: pins
 *  (they sit on top), then real shapes, then an island nation's halo. */
export function pickAt(host: GlHost, sx: number, sy: number, radius = PIN_PICK_RADIUS): Feature | null {
  const { world, viewport } = host;
  const camera = host.camera;
  const micro = microMode(host.style);

  let nearestPin: Feature | null = null;
  let nearest = radius;
  for (const feature of world.features) {
    if (!showsAsDot(feature, camera, micro)) continue;
    const [x, y] = worldToScreen(camera, viewport, feature.ux, feature.uy);
    const distance = Math.hypot(x - sx, y - sy);
    if (distance < nearest) { nearest = distance; nearestPin = feature; }
  }
  if (nearestPin) return nearestPin;

  for (const hit of host.map.queryRenderedFeatures([sx, sy], { layers: [LAYER.countries] })) {
    const feature = world.byIso3.get(String(hit.properties?.iso3));
    if (feature && !landHidden(feature, camera, micro)) return feature;
  }
  if (micro === 'off') return null;
  const haloed = new Set<string>();
  for (const hit of host.map.queryRenderedFeatures([sx, sy], { layers: [LAYER.haloFill] })) haloed.add(String(hit.properties?.iso3));
  // smallest halo first, so the smaller country wins an overlap
  for (const feature of world.haloFeatures) {
    if (haloed.has(feature.country.iso3) && haloAlpha(feature, camera) > 0) return feature;
  }
  return null;
}

/** The capital ring under this point, if the layer shows one: a ring MapLibre did not place
 *  (no room for its name) is not in the query, so a ring you cannot see cannot be hit. */
export function pickPlaceAt(host: GlHost, sx: number, sy: number, radius = CAPITAL_PICK_RADIUS): PlaceMark | null {
  const { world, viewport } = host;
  const camera = host.camera;
  if (!capitalsVisible(host.style, camera, viewport)) return null;
  const hits = host.map.queryRenderedFeatures(
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
