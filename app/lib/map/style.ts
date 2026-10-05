/**
 * What the map is asked to draw, and the palette it draws it in
 * and the app's own idea of a style: callbacks per country, resolved to feature state by
 * gl-atlas.ts. React-free, and free of anything geography-specific: a Style is just callbacks.
 */
import type { PlaceMark, Feature } from './types';

export type MicroMode = 'full' | 'dots' | 'off';

/** The effective micro mode of a style — one reading for drawing, labelling and hit-testing. */
export function microMode(style: Pick<Style, 'showPins' | 'micro'>): MicroMode {
  return style.micro ?? (style.showPins ? 'full' : 'off');
}

export interface Style {
  /** Fill for a country, or null to skip drawing it entirely. */
  fill(feature: Feature): string | null;
  /** [colour, width in CSS pixels], or null for no stroke. */
  stroke(feature: Feature): [string, number] | null;
  /** The stroke every feature shares unless its own `stroke()` says otherwise: the one border
   *  line layer is painted with it, and a feature whose stroke differs (selected, neighbour,
   *  hovered, quiz target) gets the emphasised border via feature state. Both real Style
   *  objects (overlays.ts's strokeFor/quizStrokeFor) return this as their own fallback. */
  defaultStroke?(): [string, number] | null;
  /** Country names (the Names toggle). Capital names follow the capitals layer, not this. */
  showLabels: boolean;
  /** Legacy on/off for micro-states; `micro` wins when set. */
  showPins: boolean;
  /** How micro-states and island nations draw (the Micro toggle): `full` = pin or territory
   *  halo, plus a name when `showLabels`; `dots` = a small dot each, no halo, no name; `off` =
   *  nothing, and nothing to hit. Default: `full` when showPins, else `off`. */
  micro?: MicroMode;
  /** The capitals layer: a ring per capital city once zoomed in past
   *  CAPITAL_ZOOM_FACTOR (or later, for a small country), together with its name. Off if omitted. */
  showCapitals?: boolean;
  /** The one capital the capitals quiz is asking about: drawn with the quiz-target ring at
   *  ANY zoom, and only under quizMode (every other capital ring stays hidden there). It
   *  carries no name — labels and tooltips stay suppressed, so the ring is a question, not
   *  an answer. */
  quizPlace?: PlaceMark | null;
  /**
   * True for the whole lifetime of a quiz run. Suppresses every surface that could hand
   * over the answer: no country labels and no place (capital) labels or dots here (see
   * drawLabels and capitalsVisible below); the hover tooltip — country AND place — the
   * search box and the default neighbour-glow are suppressed at their call sites in
   * app/routes/atlas.tsx and app/lib/map/atlas.ts, gated on this same flag. One name for
   * all of them, so a further surface that shows a name has one obvious place to check —
   * see CLAUDE.md's Quizzes section.
   */
  quizMode?: boolean;
}

/**
 * Every colour the map paints, resolved from app/styles/tokens.css. A map style can't be
 * `var(--x)`, so these start as the tokens' dark-theme defaults (kept in sync by hand — see
 * tokens.css's own header note) and are only ever overwritten by refreshMapColours() below,
 * never read per frame.
 */
export const COLORS = {
  ocean: '#080D13',
  context: '#16222D',
  graticule: 'rgba(78,169,201,.075)',
  graticuleMajor: 'rgba(78,169,201,.16)',
  land: '#31485A',
  microPin: '#68889D',
  labelHalo: 'rgba(8,13,19,.85)',
  labelText: 'rgba(230,238,243,.9)',
  pinEdge: 'rgba(8,13,19,.9)',
  capital: 'rgba(230,238,243,.95)',
  capitalHalo: 'rgba(8,13,19,.85)',
  capitalLabelText: 'rgba(159,179,192,1)',
  /** The pulse ring's colour, at whatever alpha the pulse's own animation wants — kept as a
   *  bare "r,g,b" triplet rather than a full colour for that reason (gl-atlas.ts's pulse). */
  pulseRgb: '232,163,61',
  /** The size-comparison drag overlay (gl-atlas.ts's compare state) — brass, so it reads as
   *  the same accent the rest of the "selected" language uses. */
  compareFill: 'rgba(232,163,61,.42)',
  compareStroke: '#F5CE86'
};

/**
 * Re-reads every entry in COLORS from tokens.css and caches it in place — called once from
 * app/routes/atlas.tsx before the first frame and again on every theme change, never from
 * per frame. getComputedStyle is real work; a frame can't afford it 60 times a
 * second, which is the whole reason COLORS is a cache rather than a live lookup.
 */
export function refreshMapColours(): void {
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string) => cs.getPropertyValue(name).trim();
  const rgb = (name: string) => read(name).replace(/\s+/g, ',');
  const abyssRgb = rgb('--abyss-rgb');
  const seaRgb = rgb('--sea-rgb');
  const inkRgb = rgb('--ink-rgb');

  COLORS.ocean = read('--ocean');
  COLORS.context = read('--map-context');
  COLORS.graticule = `rgba(${seaRgb},${read('--graticule-alpha')})`;
  COLORS.graticuleMajor = `rgba(${seaRgb},${read('--graticule-major-alpha')})`;
  COLORS.land = read('--land');
  COLORS.microPin = read('--micro-pin');
  COLORS.labelHalo = `rgba(${abyssRgb},.85)`;
  COLORS.labelText = `rgba(${inkRgb},.9)`;
  COLORS.pinEdge = `rgba(${abyssRgb},.9)`;
  COLORS.capital = `rgba(${inkRgb},.95)`;
  COLORS.capitalHalo = `rgba(${abyssRgb},.85)`;
  COLORS.capitalLabelText = read('--ink-2');
  COLORS.pulseRgb = rgb('--brass-rgb');
  COLORS.compareFill = `rgba(${COLORS.pulseRgb},.42)`;
  COLORS.compareStroke = read('--brass-2');
}

