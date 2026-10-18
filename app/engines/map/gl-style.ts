/**
 * The MapLibre style: sources, layers and the palette they are painted in. Pure data — no
 * map instance, no DOM — so the layer table can be read top to bottom as "what the map is".
 *
 * How the pieces map to the old canvas frame:
 *   countries / context / lakes / halos   vector tiles (scripts/build/build-tiles.mjs)
 *   pins, country names                    GeoJSON points at each country's anchor
 *   capitals                               GeoJSON points; ring icon + name in ONE symbol layer, so
 *                                          a ring whose name found no room is not placed either
 *   per-country colour, border emphasis,   FEATURE STATE (set by gl-atlas.ts, never by rebuilding
 *   halo strength, pin/shape switch        geometry): c, pc, sc, sw, fo, hide, dot, halo
 *
 * Feature-state keys (all optional, absent = default):
 *   c      fill colour of the land            pc  colour of the pin / halo (c, or the pin grey)
 *   sc/sw  emphasised border colour / width   fo  pin focus: 0 normal, 1 focus, 2 quiz target
 *   hide   the shape is not drawn (the country is a pin right now)
 *   dot    the pin is drawn                   halo  territory halo strength 0..1
 */
import type { FeatureCollection } from 'geojson';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

import { GRATICULE_STEPS } from './gl-geo';
import { COLORS } from './style';
import { CAPITAL_RING_HALO, CAPITAL_RING_RADIUS, HALO_EDGE_ALPHA, HALO_FILL_ALPHA } from './thresholds';

/** Tiles are 512 px, so a map zoom z is a world `512 * 2^z` CSS px wide — the camera's `zoom`. */
export const TILE_SIZE = 512;
export const zoomToPx = (z: number): number => TILE_SIZE * 2 ** z;
export const pxToZoom = (px: number): number => Math.log2(px / TILE_SIZE);

export const SOURCE = { world: 'world', points: 'points', capitals: 'capitals', quizPlace: 'quiz-place', graticule: 'graticule', compare: 'compare', pulse: 'pulse' } as const;

export const LAYER = {
  countries: 'countries',
  haloFill: 'halo-fill',
  compareFill: 'compare-fill',
  capitals: 'capitals',
  pins: 'pins',
  labelsCountry: 'labels-country',
  labelsMicro: 'labels-micro'
} as const;

/** Layers whose filter holds a changing set of iso3 codes (see gl-atlas.ts's syncView). */
export const FILTERED_LAYERS = [LAYER.labelsCountry, LAYER.labelsMicro, LAYER.capitals] as const;

export const CAPITAL_RING_IMAGE = 'zemya-capital-ring';

/** The pin sizes and the quiz target's ring, as the canvas version drew them. */
const PIN_RADIUS = 4.2;
const PIN_FOCUS_RADIUS = 6.5;
const PIN_TARGET_RADIUS = 9;
const PIN_TARGET_RING_GAP = 7;
const QUIZ_RING_RADIUS = 5;
const QUIZ_RING_HALO_GAP = 6;

/* Expression builders. Typed loosely on purpose: the style spec's expression types are a
   thicket of tuple types that only get in the way of reading a layer table. */
type Expr = any[];
/** A filter that matches nothing: the label and capital layers start (and fall back) here. */
export const NONE: Expr = ['==', ['get', 'iso3'], ''];
const state = (key: string): Expr => ['feature-state', key];
const flag = (key: string): Expr => ['boolean', state(key), false];
const num = (key: string): Expr => ['coalesce', state(key), 0];

export interface GlPalette {
  /** [colour, width] of the border every country shares. */
  border: [string, number];
}

export interface GlStyleInputs {
  palette: GlPalette;
  tilesUrl: string;
  attribution: string;
  fonts: Record<string, { url: string; unicodeRange: string }[]>;
  /** The glyphs URL: required by the spec once a layer has text. Served by a protocol that
   *  answers every request with an empty range (every glyph comes from `fonts` instead). */
  glyphsUrl: string;
  /** The point sets and the graticule, inline so the first frame has them. */
  geo: { points: FeatureCollection; capitals: FeatureCollection; graticule: FeatureCollection };
}

const MEDIUM = ['Archivo Medium'];
const REGULAR = ['Archivo'];

export function buildLayers({ border }: GlPalette): LayerSpecification[] {
  const ink = COLORS.labelText;
  const layers = [
    { id: 'ocean', type: 'background', paint: { 'background-color': COLORS.ocean } },

    // one layer per step; gl-atlas.ts gives each its zoom range, relative to the world view
    ...GRATICULE_STEPS.map(step => ({
      id: `graticule-${step}`, type: 'line', source: SOURCE.graticule, filter: ['==', ['get', 's'], step],
      paint: { 'line-color': COLORS.graticule, 'line-width': 1 }
    })),
    {
      id: 'graticule-major', type: 'line', source: SOURCE.graticule, filter: ['==', ['get', 's'], 0],
      paint: { 'line-color': COLORS.graticuleMajor, 'line-width': 1 }
    },

    { id: 'context', type: 'fill', source: SOURCE.world, 'source-layer': 'context', paint: { 'fill-color': COLORS.context, 'fill-antialias': false } },

    // an island nation's territory, beneath its land: strength 0..1 from feature state
    {
      id: LAYER.haloFill, type: 'fill', source: SOURCE.world, 'source-layer': 'halos',
      paint: { 'fill-color': ['coalesce', state('pc'), COLORS.microPin], 'fill-opacity': ['*', num('halo'), HALO_FILL_ALPHA] }
    },
    {
      id: 'halo-edge', type: 'line', source: SOURCE.world, 'source-layer': 'halos', layout: { 'line-join': 'round' },
      paint: { 'line-color': ['coalesce', state('pc'), COLORS.microPin], 'line-opacity': ['*', num('halo'), HALO_EDGE_ALPHA], 'line-width': 1.4 }
    },

    {
      id: LAYER.countries, type: 'fill', source: SOURCE.world, 'source-layer': 'countries',
      paint: {
        'fill-color': ['coalesce', state('c'), COLORS.land],
        'fill-opacity': ['case', flag('hide'), 0, 1],
        // abutting countries share an edge; the border line covers it, and antialiasing the
        // fill would only let the ocean bleed through the seam
        'fill-antialias': false
      }
    },
    // lakes on top of the land they cut into, so the Caspian reads as water, not a hole
    { id: 'lakes', type: 'fill', source: SOURCE.world, 'source-layer': 'lakes', paint: { 'fill-color': COLORS.ocean, 'fill-antialias': false } },

    {
      id: 'borders', type: 'line', source: SOURCE.world, 'source-layer': 'countries', layout: { 'line-join': 'round' },
      paint: { 'line-color': border[0], 'line-width': border[1], 'line-opacity': ['case', flag('hide'), 0, 1] }
    },
    // selection, neighbours, hover: the emphasised border, in two layers so the heavier
    // (selected / quiz target) always sits over the lighter ones and over every default border
    {
      id: 'ring-soft', type: 'line', source: SOURCE.world, 'source-layer': 'countries', layout: { 'line-join': 'round' },
      paint: { 'line-color': ['coalesce', state('sc'), 'rgba(0,0,0,0)'], 'line-width': ['case', ['<', num('sw'), 1.5], num('sw'), 0] }
    },
    {
      id: 'ring-strong', type: 'line', source: SOURCE.world, 'source-layer': 'countries', layout: { 'line-join': 'round' },
      paint: { 'line-color': ['coalesce', state('sc'), 'rgba(0,0,0,0)'], 'line-width': ['case', ['>=', num('sw'), 1.5], num('sw'), 0] }
    },

    // the size-comparison outline dragged over the map
    { id: LAYER.compareFill, type: 'fill', source: SOURCE.compare, paint: { 'fill-color': COLORS.compareFill, 'fill-antialias': true } },
    { id: 'compare-edge', type: 'line', source: SOURCE.compare, layout: { 'line-join': 'round' }, paint: { 'line-color': COLORS.compareStroke, 'line-width': 1.6 } },

    // micro-state pins: the quiz target's outer ring, then the dot
    {
      id: 'pins-ring', type: 'circle', source: SOURCE.points,
      paint: {
        'circle-radius': PIN_TARGET_RADIUS + PIN_TARGET_RING_GAP, 'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 2.5, 'circle-stroke-color': ['coalesce', state('pc'), COLORS.microPin],
        'circle-stroke-opacity': ['case', ['all', flag('dot'), ['==', num('fo'), 2]], 1, 0]
      }
    },
    {
      id: LAYER.pins, type: 'circle', source: SOURCE.points,
      paint: {
        'circle-radius': ['match', num('fo'), 2, PIN_TARGET_RADIUS, 1, PIN_FOCUS_RADIUS, PIN_RADIUS],
        'circle-color': ['coalesce', state('pc'), COLORS.microPin],
        'circle-opacity': ['case', flag('dot'), 1, 0],
        'circle-stroke-width': 1.2, 'circle-stroke-color': COLORS.pinEdge,
        'circle-stroke-opacity': ['case', flag('dot'), 1, 0]
      }
    },

    // the capitals quiz's target: a ring and an outer ring, each over a dark halo
    ...[[QUIZ_RING_RADIUS + QUIZ_RING_HALO_GAP, 2], [QUIZ_RING_RADIUS, 2.4]].flatMap(([radius, width], i) => [
      {
        id: `quiz-place-halo-${i}`, type: 'circle', source: SOURCE.quizPlace,
        paint: { 'circle-radius': radius, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': width + 2.4, 'circle-stroke-color': COLORS.capitalHalo }
      },
      {
        id: `quiz-place-ring-${i}`, type: 'circle', source: SOURCE.quizPlace,
        paint: { 'circle-radius': radius, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': width, 'circle-stroke-color': COLORS.capital }
      }
    ]),

    // capitals: ring icon + name in one layer. Neither icon-optional nor text-optional, so
    // MapLibre places both or neither — "a ring without its name is the one thing this layer
    // must not show". Beneath the country names, which therefore claim their room first.
    {
      id: LAYER.capitals, type: 'symbol', source: SOURCE.capitals, filter: NONE,
      layout: {
        'icon-image': CAPITAL_RING_IMAGE, 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'text-field': ['get', 'name'], 'text-font': REGULAR, 'text-size': 11,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': (CAPITAL_RING_RADIUS + 5) / 11,
        'text-padding': 2, 'text-max-width': 14,
        'symbol-sort-key': ['-', 0, ['get', 'pop']]
      },
      paint: { 'text-color': COLORS.capitalLabelText, 'text-halo-color': COLORS.labelHalo, 'text-halo-width': 1.5 }
    },
    // names of micro-states and island nations, beside their pin or halo
    {
      id: LAYER.labelsMicro, type: 'symbol', source: SOURCE.points, filter: NONE,
      layout: {
        'text-field': ['get', 'name'], 'text-font': MEDIUM, 'text-size': 11,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': (PIN_RADIUS + 5) / 11,
        'text-padding': 2, 'text-max-width': 14, 'symbol-sort-key': ['-', 0, ['get', 'area']]
      },
      paint: { 'text-color': ink, 'text-halo-color': COLORS.labelHalo, 'text-halo-width': 1.5 }
    },
    // country names, largest first: the collision pass places in sort-key order
    {
      id: LAYER.labelsCountry, type: 'symbol', source: SOURCE.points, filter: NONE,
      layout: {
        'text-field': ['get', 'name'], 'text-font': MEDIUM, 'text-size': ['get', 'sz'],
        'text-padding': 3, 'text-max-width': 12, 'symbol-sort-key': ['-', 0, ['get', 'area']]
      },
      paint: { 'text-color': ink, 'text-halo-color': COLORS.labelHalo, 'text-halo-width': 1.5 }
    },

    { id: 'pulse', type: 'circle', source: SOURCE.pulse, paint: { 'circle-radius': 0, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 0, 'circle-stroke-color': `rgb(${COLORS.pulseRgb})`, 'circle-stroke-opacity': 0 } }
  ];
  return layers as LayerSpecification[];
}

export function buildStyle(inputs: GlStyleInputs): StyleSpecification {
  const empty = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  return {
    version: 8,
    transition: { duration: 0, delay: 0 },
    projection: { type: 'mercator' },
    glyphs: inputs.glyphsUrl,
    'font-faces': Object.fromEntries(
      Object.entries(inputs.fonts).map(([name, faces]) => [name, faces.map(f => ({ url: f.url, 'unicode-range': f.unicodeRange.split(',') }))])
    ),
    sources: {
      [SOURCE.world]: {
        type: 'vector', url: inputs.tilesUrl, attribution: inputs.attribution,
        promoteId: { countries: 'iso3', halos: 'iso3' }
      },
      [SOURCE.points]: { type: 'geojson', data: inputs.geo.points, promoteId: 'iso3' },
      [SOURCE.capitals]: { type: 'geojson', data: inputs.geo.capitals, promoteId: 'iso3' },
      [SOURCE.quizPlace]: empty,
      [SOURCE.graticule]: { type: 'geojson', data: inputs.geo.graticule },
      [SOURCE.compare]: empty,
      [SOURCE.pulse]: empty
    },
    layers: buildLayers(inputs.palette)
  } as unknown as StyleSpecification;
}
