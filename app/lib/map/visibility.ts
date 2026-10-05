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
  CAPITAL_MIN_SHAPE_WIDTH, CAPITAL_ZOOM_FACTOR, capitalRevealFactor, DOT_MAX_SIDE_PX, haloStrength
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
  // an island nation's halo stands in for the pin; its land is hidden while the halo shows (landHidden)
  if (feature.halo) return false;
  return equivalentSidePx(feature, camera) < DOT_MAX_SIDE_PX;
}


const EQUATOR_KM = 40075;

/** On-screen side, in CSS pixels, of a square as large as the country (sqrt of its area), at the
 *  current zoom and the country's latitude (Mercator stretches by 1/cos). The measure for a
 *  country whose bounding box says little about how much of it there is. */
export function equivalentSidePx(feature: Feature, camera: CameraState): number {
  const cos = Math.max(0.05, Math.cos((feature.anchor[1] * Math.PI) / 180));
  return (Math.sqrt(Math.max(feature.country.area, 0)) * camera.zoom) / (EQUATOR_KM * cos);
}

/** Whether this feature shows as a dot this frame under `micro`. One rule sorts every small
 *  country: an island nation with a territory halo is an AREA, in every mode but Off, and never a
 *  dot; any other country is a DOT while its equivalent square is under DOT_MAX_SIDE_PX, and its
 *  shape after. One predicate for drawing, labelling and hit-testing; `landHidden` below is its
 *  other half, so a country is never both. */
export function showsAsDot(feature: Feature, camera: CameraState, micro: MicroMode): boolean {
  if (micro === 'off') return false;
  return drawsAsPin(feature, camera);
}

/** Whether the country's own land is withheld this frame: it is a pin (with Micro off nothing
 *  replaces it, as before), or its halo is showing — the halo is the area, and the specks of
 *  land inside it would read as a dot. The land returns as the halo fades out. */
export function landHidden(feature: Feature, camera: CameraState, micro?: MicroMode): boolean {
  if (drawsAsPin(feature, camera)) return true;
  return micro !== 'off' && haloAlpha(feature, camera) > 0;
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
