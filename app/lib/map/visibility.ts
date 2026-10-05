/**
 * The per-frame decisions that depend only on the camera: is a country a shape or a pin right
 * now, how strong is its halo, does its capital show. One home for them so the renderer, the
 * hit-testing and the labelling can never disagree — and so every renderer (canvas or GL)
 * asks the same questions. The thresholds themselves live in thresholds.ts.
 */
import type { CameraState, Viewport } from './camera';
import { homeZoom } from './camera';
import { lonToX } from './projection';
import type { MicroMode, Style } from './style';
import {
  CAPITAL_MIN_SHAPE_WIDTH, CAPITAL_ZOOM_FACTOR, capitalRevealFactor, haloStrength, PIN_MAX_WIDTH
} from './thresholds';
import type { Feature, PlaceMark } from './types';

/* PIN_MAX_WIDTH, the capital ring's size and CAPITAL_MIN_SHAPE_WIDTH live in thresholds.ts,
   shared with the quiz camera (follow.ts) and tied to each other there. */

/** A feature's on-screen width in CSS pixels at the current zoom, from its (unwrapped,
 *  already-consistent — see topology.ts) bbox. A feature with no bbox at all has no
 *  shape to draw at any zoom, so it is always a pin. */
export function onScreenWidth(feature: Feature, camera: CameraState): number {
  if (!feature.bbox) return 0;
  const [minLon, , maxLon] = feature.bbox;
  return (lonToX(maxLon) - lonToX(minLon)) * camera.zoom;
}

/** Whether this feature draws as a pin THIS FRAME. Never both a pin and a shape, and
 *  never neither — renderer, hit-testing and labelling all call this so they can't
 *  disagree with each other. */
export function drawsAsPin(feature: Feature, camera: CameraState): boolean {
  if (!feature.path && !feature.fullPath) return true;
  // an island nation's halo stands in for the pin; its land is drawn at every zoom, on top
  if (feature.halo) return false;
  return onScreenWidth(feature, camera) < PIN_MAX_WIDTH;
}


/** Whether this feature shows as a dot this frame under `micro`: a pin-sized country, and in
 *  `dots` mode also an island nation whose land is still too small to read (its halo would
 *  show). One predicate for drawing, labelling and hit-testing. */
export function showsAsDot(feature: Feature, camera: CameraState, micro: MicroMode): boolean {
  if (micro === 'off') return false;
  if (drawsAsPin(feature, camera)) return true;
  return micro === 'dots' && haloAlpha(feature, camera) > 0;
}

/** How strongly this feature's halo shows right now: 0 for no halo or readable land. One
 *  number for drawing and hit-testing, so a halo you can't see can't be hit. */
export function haloAlpha(feature: Feature, camera: CameraState): number {
  return feature.halo ? haloStrength(feature.pieceWidth * camera.zoom) : 0;
}

/** Whether the capitals layer draws (and can be hovered or clicked) this frame. quizMode
 *  is a hard veto: a capital's ring is not an answer, but the hover tooltip and label that
 *  come with it are, and one predicate for all three means they cannot disagree. */
export function capitalsVisible(
  style: Pick<Style, 'showCapitals' | 'quizMode'>,
  camera: CameraState,
  viewport: Viewport
): boolean {
  return (
    Boolean(style.showCapitals) &&
    !style.quizMode &&
    camera.zoom >= homeZoom(viewport) * CAPITAL_ZOOM_FACTOR
  );
}

/** Second gate, per capital: its country is a drawn shape right now, wide enough that the ring sits
 *  on an outline rather than floating beside it (CAPITAL_MIN_SHAPE_WIDTH, derived from
 *  PIN_MAX_WIDTH — so it can never pass while the country is a pin), AND we are past the zoom its
 *  AREA calls for (capitalRevealFactor: small countries wait longer). Rings, names and
 *  hit-testing all go through this, so a ring, its name and its hover cannot disagree. */
export function capitalShapeShowing(mark: PlaceMark, camera: CameraState, viewport: Viewport): boolean {
  if (drawsAsPin(mark.feature, camera) || onScreenWidth(mark.feature, camera) < CAPITAL_MIN_SHAPE_WIDTH) return false;
  const home = homeZoom(viewport);
  return camera.zoom >= home * capitalRevealFactor(mark.feature.country.area, mark.place.lat, home, mark.place.iso3);
}


/** How close, in CSS px, a pointer must be to a capital's ring to hit it (touch uses more). */
export const CAPITAL_PICK_RADIUS = 7;
