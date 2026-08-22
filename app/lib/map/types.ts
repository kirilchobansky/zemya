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
}

export interface WorldData {
  version: number;
  generated: { detail: number; quantisation: number };
  grid: { x0: number; y0: number; xs: number; ys: number };
  /** Delta-encoded, quantised arcs. Decode with decodeArcs(). */
  arcs: [number, number][][];
  geometries: { id: string; multi: boolean; arcs: number[][] | number[][][] }[];
  countries: CountryRecord[];
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
  /** Too small to render as a shape at this detail level — drawn and hit-tested as a pin. */
  micro: boolean;
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
}
