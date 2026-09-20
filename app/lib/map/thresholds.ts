/**
 * The on-screen sizes that decide what the map draws for a small country, in one place so
 * they cannot drift apart. renderer.ts (pin vs shape, capital rings) and follow.ts (the quiz
 * camera's minimum target size) both read them; nothing here knows about either.
 *
 * Tune by looking, then check test/unit/renderer.test.ts and follow.test.ts still hold — they
 * assert the relations between these, not their values.
 */

/** Below this on-screen width, in CSS pixels, a country draws as a pin instead of its real
 *  shape — a per-frame decision from the current zoom. Too low and micro-states are
 *  unclickable slivers before they're worth drawing as shapes; too high and mid-size islands
 *  stay pins longer than they should. */
export const PIN_MAX_WIDTH = 7;

/** A capital's ring: radius, and the extra its dark halo adds outside it. */
export const CAPITAL_RING_RADIUS = 3.4;
export const CAPITAL_RING_HALO = 1.7;
export const CAPITAL_RING_DIAMETER = 2 * (CAPITAL_RING_RADIUS + CAPITAL_RING_HALO);

/**
 * A capital ring (and its name, and its hit-test) is only there once its country is at least
 * this wide on screen: a country's worth of shape PLUS the ring's own diameter. Derived from
 * PIN_MAX_WIDTH, not set beside it — a ring wider than the outline it belongs to reads as a
 * dot floating in the sea next to a pin, which is what the map looked like before the two were
 * tied together. Being at least a pin's width, it can never show while the country is a pin.
 */
export const CAPITAL_MIN_SHAPE_WIDTH = PIN_MAX_WIDTH + CAPITAL_RING_DIAMETER;

/**
 * When a capital appears, in zoom terms. Ring and name appear TOGETHER (a ring alone reads as an
 * unlabelled dot), at the later of what used to be two thresholds: 9x homeZoom (a multiple of
 * homeZoom, the zoom at which the whole world fills the viewport). That is the floor for every
 * country. Tuned by playing, like the rest of this file.
 */
export const CAPITAL_ZOOM_FACTOR = 9;
/**
 * Small countries wait longer, by a calculation from their AREA rather than a per-country list:
 * the capital appears once the country's equivalent square (side = sqrt(area)) is this many px
 * across on screen. Big countries are already past that at 9x, so only small ones are held back —
 * Cyprus, Jamaica, Luxembourg a few doublings later; Liechtenstein, Malta, the Maldives and the
 * Caribbean islands much later. Area, not the bbox width, because an archipelago's bbox (Maldives,
 * Bahamas) is wide while its land is not.
 */
export const CAPITAL_REVEAL_SIDE_PX = 60;
/** ...but never asking for more zoom than this (x homeZoom): the smallest states hit the
 *  CAPITAL_MIN_SHAPE_WIDTH outline gate first, and the camera's own cap is 320x. */
export const CAPITAL_REVEAL_MAX_FACTOR = 200;
const EQUATOR_KM = 40075;

/**
 * The zoom (x homeZoom) from which a country's capital shows: `CAPITAL_ZOOM_FACTOR` for anything
 * big, later for small ones. `homePx` is homeZoom(viewport): world-width in px at factor 1.
 * Mercator stretches by 1/cos(lat), so a high-latitude country needs less zoom for the same side.
 */
export function capitalRevealFactor(areaKm2: number, latDeg: number, homePx: number): number {
  const side = Math.sqrt(Math.max(areaKm2, 1));
  const cos = Math.max(0.05, Math.cos((latDeg * Math.PI) / 180));
  const pxWorld = (CAPITAL_REVEAL_SIDE_PX * EQUATOR_KM * cos) / side;
  return Math.max(CAPITAL_ZOOM_FACTOR, Math.min(CAPITAL_REVEAL_MAX_FACTOR, pxWorld / homePx));
}
