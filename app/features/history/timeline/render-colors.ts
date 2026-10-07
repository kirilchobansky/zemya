/**
 * Colours and the tunable RENDER_CONFIG of the history renderer.
 */
import { clamp } from './render-easing';
import { type EntryKind, type ZoomLevel } from './scale';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

/** Mixes `hex` toward black (amount > 0) or white (amount < 0) by `Math.abs(amount)` —
 *  the one place this module derives a "dim" or "bright" gradient stop from a design base
 *  colour, instead of hand-picking a second hex per kind. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const toward = amount >= 0 ? 0 : 255;
  const f = Math.abs(amount);
  const mix = (v: number) => Math.round(v + (toward - v) * f);
  const toHex = (v: number) => mix(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// "Calm and dark" palette (see CLAUDE.md-linked design pass): one flat accent hue per
// kind, used at low alpha for idle fills/rails and higher alpha for the active state —
// no gradients, no per-kind dim/bright pair.
const PERIOD_COLOR = '#8a97e8';

const RULER_COLOR = '#4fd1ea';

const GOVERNMENT_COLOR = '#b59cff';

const EVENT_COLOR = '#ffc46b';

export const COLORS = {
  bgTop: '#0a0e1c', // page background gradient, top
  bgBottom: '#151b36', // page background gradient, bottom
  period: PERIOD_COLOR,
  ruler: RULER_COLOR,
  government: GOVERNMENT_COLOR,
  event: EVENT_COLOR,
  ink2: '#9FB3C0', // --ink-2 — tick labels
  ink3: '#67808F', // --ink-3 — tick labels, out-of-range zone labels
  // Capsule text is #eef1ff regardless of kind — every fill (see kindColorHex) stays dark
  // enough for it to read against. white is the capsule name, textDim the role line
  // beneath it.
  white: '#EEF1FF',
  whiteDim: 'rgba(238,241,255,.75)',
  brass2: '#F5CE86', // --brass-2 — the centre date readout's own text
  labelHalo: 'rgba(8,13,19,.85)', // --abyss, high opacity
  centreLine: 'rgba(232,163,61,.32)' // --brass, faint — confined inside the content band only
} as const;

/** Background wash for period capsules' translucent bands, one colour per period so
 *  adjacent eras read as distinct background colour rather than a uniform tint — picked
 *  by the period's stable position in the WHOLE dataset (periodIndexOf in render()), not
 *  by draw order, so a given era's wash never changes colour as you pan. */
export const PERIOD_BAND_COLORS: readonly string[] = [
  'rgba(49,72,90,.26)', 'rgba(42,95,117,.22)', 'rgba(70,58,110,.22)', 'rgba(120,90,40,.18)'
];

export const RENDER_CONFIG = {
  /** Reserved strip at the very top of the cylinder for year ticks and their labels —
   *  "year labels stay on the cylinder's top surface." */
  tickStripHeight: 28,
  tickMajorLength: 10,
  tickMinorLength: 5,
  /** Gap between the tick strip and the first wire, and between the last wire and the
   *  cylinder's own bottom edge. */
  wirePaddingTop: 8,
  wirePaddingBottom: 12,
  /** Gap between adjacent wires (period/ruler/government/event), and between two
   *  overlapping entries' sub-rows on the SAME wire. */
  wireGap: 6,
  /** Inset so two adjacent capsules never visually touch. */
  capsuleGapPx: 5,
  capsuleHPad: 10,
  capsuleMinFontPx: 15,
  capsuleMaxFontPx: 36,
  /** Fixed corner radius for a capsule's rounded rect — no longer a full pill (radius =
   *  half the short side); capped by the capsule's own half-width/height so a very small
   *  capsule still draws cleanly. */
  capsuleCornerRadiusPx: 10,
  /** A period/ruler/government bar never shrinks below this width — "always drawn as
   *  bars... thin coloured strips with no text" at far zoom, rather than disappearing
   *  once its true duration maps to under a pixel. */
  minBarWidthPx: 2,
  centreDateGap: 10,
  centreDateFontPx: 13,
  /** Inner margin at both ends of the canvas, along the time axis — event pins, dots and
   *  labels are held inside it (never drawn past it) and fade out over its own width as
   *  their true time position nears the canvas edge, rather than being cut off there. The
   *  background and lane tracks ignore this — they still run edge to edge. */
  edgeMarginPx: 24,
  fadeZoneLabelFontPx: 13,
  /** Event pin geometry — see drawEventPins. Height fractions of the event wire's own
   *  full height, by tier (1 is the loudest); tiers beyond 3 fall back to the tier-3
   *  fraction, an unspecified extrapolation of the given 1/0.65/0.4 ladder. */
  pinHeightFracByTier: { 1: 1, 2: 0.65, 3: 0.4 } as Readonly<Record<number, number>>,
  pinDotRadiusPx: 2.5,
  pinLabelGapPx: 5,
  /** Event label font size by zoom level — grows from decade zoom (14px) to month zoom
   *  and finer (20px); millennium/century read the same as decade (nothing finer to grow
   *  into yet), year sits at the midpoint — a judgement call on the exact curve. */
  pinLabelFontPxByLevel: {
    millennium: 15, century: 15, decade: 15, year: 18, month: 22, day: 22
  } as Readonly<Record<ZoomLevel, number>>
} as const;

/** Duration order, top to bottom inside the cylinder — periods longest-lived, events
 *  shortest (a single moment). Fixed, mirrors scale.ts's KIND_RANK. */
export const WIRE_ORDER: readonly EntryKind[] = ['period', 'ruler', 'government', 'event'];

/** Fixed row height (px) for every lane, including period — "every lane has ONE fixed
 *  height," constant at every zoom level and never dependent on the cylinder's own size.
 *  Events get the tallest row: a pin's label can carry a second, smaller exact-date line
 *  (drawEventPins) that rulers/governments don't. Values are the original constants raised
 *  ~25% (ruler/government 36 -> 45, event 52 -> 65, period 48 -> 60) now that the cylinder
 *  itself is a fixed size rather than shrinking lanes to fit an eased container. Then raised
 *  a further ~10% (60/45/45/65 -> 66/50/50/72); capsule and pin heights and the capsule
 *  font (rowHeight * 0.42) all derive from these, and the label fonts below follow. */
export const ROW_HEIGHT_BY_KIND: Readonly<Record<EntryKind, number>> = { period: 66, ruler: 50, government: 50, event: 72 };

/** `dim`/`bright` are the capsule's OWN fill gradient stops. For period they're the
 *  cylinder's own dark/lit tones (unchanged). For ruler/government/event they're a dark
 *  shade of the kind's hue — NOT the bright accent itself, so white capsule text stays
 *  readable — derived from `stroke` (the kind's bright accent hue), which is used only
 *  for the capsule outline and, via drawWireCapsules' focus handling, the centre-focus
 *  highlight. */
export function kindColorHex(kind: EntryKind): string {
  switch (kind) {
    case 'period': return COLORS.period;
    case 'ruler': return COLORS.ruler;
    case 'government': return COLORS.government;
    case 'event': return COLORS.event;
  }
}
