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
