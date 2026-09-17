/** Shapes emitted by scripts/build-content.mjs. Keep in sync with that file. */

export interface CountryRecord {
  /** ISO 3166-1 numeric, as a string. Joins a country to its polygon. */
  id: string;
  iso3: string;
  iso2: string;
  /** URL segment. Stable once shipped — see scripts/lib/slug.mjs. */
  slug: string;
  name: string;
  officialName: string;
  emoji: string;
  capital: string | null;
  currencyCode: string | null;
  currencyName: string | null;
  currencySymbol: string;
  population: number;
  area: number;
  density: number;
  languages: string[];
  language: string | null;
  languageFamily: string;
  religion: string;
  religionGroup: string;
  /** ISO3 codes, already filtered to countries present in this dataset. */
  borders: string[];
  landlocked: boolean;
  latlng: [number, number];
  region: string;
  subregion: string;
  hook: string;
  flagDescription: string;
  outlineDescription: string;
  /** Every string a user could reasonably type to name this country in the "Name the
   *  Country" quiz — see scripts/build-content.mjs's alias-building step and
   *  app/lib/geography/names.ts's matcher. Deduped, two-letter ISO codes dropped, and
   *  anything that would ambiguously match another country dropped from both. */
  aliases: string[];
  /** Facet name -> reason, for a fact the content marks genuinely disputed (see
   *  content/geography/countries/*.yaml's `disputed:` block). Keyed as a plain string
   *  here rather than typed against Facet — that type lives in the geography layer, and
   *  this file must not import it — but the geography layer's applicableFacets() and
   *  questions.ts both read it and treat the keys as Facet values. Always present, empty
   *  when nothing about this country is disputed. */
  disputed: Record<string, string>;
}

export interface WorldData {
  version: number;
  generated: { detail: number; quantisation: number };
  grid: { x0: number; y0: number; xs: number; ys: number };
  /** Delta-encoded, quantised arcs. Decode with decodeArcs(). */
  arcs: [number, number][][];
  geometries: { id: string; multi: boolean; arcs: number[][] | number[][][] }[];
  countries: CountryRecord[];
  /** Large inland water bodies missing from the country polygons themselves — world-atlas
   *  ships no lakes layer, so these are the holes already punched into its separate land
   *  layer (see scripts/build-content.mjs), re-encoded into this file's own arc pool.
   *  Drawn as water, not clickable, not joined to any country. */
  lakes: { id: string; arcs: number[][] }[];
}

export type LonLat = [number, number];
export type Ring = LonLat[];

/** A country joined to its decoded geometry. */
export interface Feature {
  country: CountryRecord;
  /** Outer and inner rings, grouped by polygon. Empty for Tuvalu. */
  polygons: Ring[][];
  /** [minLon, minLat, maxLon, maxLat], or null when there is no polygon. */
  bbox: [number, number, number, number] | null;
  /** Where to put the label / pin, in lon-lat. */
  anchor: LonLat;
  /** Anchor projected into the unit square. */
  ux: number;
  uy: number;
  /** True when the country's real angular size is under MICRO_DEGREES — a fact about the
   *  country, not about whether it has a path. Every feature with polygons gets a path
   *  and is hit-tested as a shape; the renderer decides per frame, from the feature's
   *  on-screen width at the current zoom, whether to draw a pin instead. Kept mostly so
   *  a caller can say "this one is always going to be small" without re-deriving it. */
  tiny: boolean;
  path: Path2D | null;
  /** Resolved neighbours, populated after all features are built. */
  neighbours: Feature[];
}

/** Landmasses with no country record — Greenland, Western Sahara, dependencies. */
export interface ContextShape {
  path: Path2D;
}

export interface World {
  data: WorldData;
  features: Feature[];
  byIso3: Map<string, Feature>;
  bySlug: Map<string, Feature>;
  byId: Map<string, Feature>;
  context: ContextShape[];
  /** Built from data.lakes the same way context shapes are — see ContextShape. */
  lakes: ContextShape[];
}
