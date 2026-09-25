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
  /** Width / height of the flag's own viewBox (see scripts/build-content.mjs) — most
   *  flags ship as 4:3 in the source data, but the true ratio varies (Nepal is not even a
   *  rectangle; Switzerland and the Vatican are square). Flag.tsx sets this as an explicit
   *  CSS aspect-ratio rather than assuming 4:3. */
  flagRatio: number;
  /** This country's flag is genuinely still hard to tell apart from another's even with
   *  true aspect ratios (see content/geography/confusable-flags.yaml) — naming that other
   *  country in the "Name the Flag" quiz is accepted too. `aliases`/`note` are the OTHER
   *  country's own, denormalised at build time so matching doesn't need a second lookup.
   *  Undefined for every country not on the curated list. */
  confusableFlag?: { iso3: string; aliases: string[]; note: string };
  /** Every string a user could reasonably type to name this country in the "Name the
   *  Country" quiz — see scripts/build-content.mjs's alias-building step and
   *  app/lib/geography/names.ts's matcher. Deduped, two-letter ISO codes dropped, and
   *  anything that would ambiguously match another country dropped from both. */
  aliases: string[];
  /** Every string that names this country's CAPITAL in the "Name the Capital" quiz: the
   *  authored `capital` first, then the curated alternates in
   *  content/geography/capital-aliases.yaml (Kiev, Nur-Sultan, South Africa's other two
   *  capitals, ...). Matched with the same normaliseName as `aliases`. A normalised name
   *  belongs to one country only — the build throws otherwise. */
  capitalAliases: string[];
  /** Facet name -> reason, for a fact the content marks genuinely disputed (see
   *  content/geography/countries/*.yaml's `disputed:` block). Keyed as a plain string
   *  here rather than typed against Facet — that type lives in the geography layer, and
   *  this file must not import it — but the geography layer's applicableFacets() and
   *  questions.ts both read it and treat the keys as Facet values. Always present, empty
   *  when nothing about this country is disputed. */
  disputed: Record<string, string>;
}

/**
 * A named point on the map, as scripts/build-content.mjs emits it. `kind` exists so that
 * "the top 3 cities per country" later is more rows plus a filter, not a rewrite; today
 * every row is a capital, one per country. `name` is the country's AUTHORED capital name
 * (what its dossier and the capital quiz say), not GeoNames' spelling of it.
 */
export interface Place {
  name: string;
  iso3: string;
  kind: 'capital';
  lon: number;
  lat: number;
  population: number;
}

/**
 * The geometry half of a world payload — everything scripts/build-content.mjs emits at a
 * given simplification detail. Shared by both public/data/geography/world.json (detail 0,
 * full 1:10m) and world-coarse.json (detail 0.006, ~48,600 points) — see topology.ts's
 * attachFullDetail and CLAUDE.md's Performance section for why there are two.
 */
export interface GeometryData {
  version: number;
  generated: { detail: number; quantisation: number };
  grid: { x0: number; y0: number; xs: number; ys: number };
  /** Delta-encoded, quantised arcs. Decode with decodeArcs(). */
  arcs: [number, number][][];
  geometries: { id: string; multi: boolean; arcs: number[][] | number[][][] }[];
  /** Large inland water bodies missing from the country polygons themselves — world-atlas
   *  ships no lakes layer, so these are the holes already punched into its separate land
   *  layer (see scripts/build-content.mjs), re-encoded into this file's own arc pool.
   *  Drawn as water, not clickable, not joined to any country. */
  lakes: { id: string; arcs: number[][] }[];
  /** Capital-city points. Carried by BOTH payloads (a few KB), not just the full one, so
   *  the capitals layer and the capital quiz's target dot exist from the very first paint
   *  rather than after the 3.4 MB download. */
  places: Place[];
}

/** The full payload: geometry plus everything non-geometric. Only world.json carries
 *  `countries` — world-coarse.json is GeometryData alone, so it never duplicates country
 *  records, names or borders (see build-content.mjs). */
export interface WorldData extends GeometryData {
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
  /** True when the country's real angular size is under MICRO_DEGREES — a fact about the
   *  country, not about whether it has a path. Every feature with polygons gets a path
   *  and is hit-tested as a shape; the renderer decides per frame, from the feature's
   *  on-screen width at the current zoom, whether to draw a pin instead. Kept mostly so
   *  a caller can say "this one is always going to be small" without re-deriving it. */
  tiny: boolean;
  /** Reduced-detail shape (world-coarse.json), built first — this is what buildWorld()
   *  populates, since it's built from the coarse payload so the map can paint before the
   *  full one arrives. bbox/anchor/ux/uy/tiny/polygons above are ALSO computed from
   *  whichever geometry most recently ran through topology.ts's finalizeFeature — coarse
   *  here, full again once attachFullDetail runs — because a coarse-detail centroid is
   *  close to but not identical to the full-detail one, and that was once enough to move
   *  a country's own name label a few pixels once you looked for it. */
  path: Path2D | null;
  /** Full 1:10m detail (world.json), attached in place once it loads — see
   *  topology.ts's attachFullDetail. Null until then, or for a feature whose full
   *  geometry is genuinely degenerate (Vatican City). The renderer and pick() use this
   *  above the LOD zoom threshold when it exists, `path` otherwise. */
  fullPath: Path2D | null;
  /** Resolved neighbours, populated after all features are built. */
  neighbours: Feature[];
}

/** A Place joined to its country's Feature and projected into the unit square, ready for
 *  the renderer: `ux`/`uy` are what worldToScreen() takes, wrapped like Feature.ux. */
export interface PlaceMark {
  place: Place;
  feature: Feature;
  ux: number;
  uy: number;
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
  /** Coarse-detail landmasses with no country record (Greenland, Western Sahara,
   *  dependencies) — see Feature.path's own doc comment for why "coarse first" here too. */
  context: ContextShape[];
  /** Built from data.lakes the same way context shapes are — see ContextShape. */
  lakes: ContextShape[];
  /** Full-detail counterparts to context/lakes, empty until attachFullDetail runs. */
  fullContext: ContextShape[];
  fullLakes: ContextShape[];
  /** Every place that joined to a country in this dataset. */
  places: PlaceMark[];
  /**
   * Every feature's outline, unioned into one Path2D per detail level — built lazily on
   * first need (topology.ts's mergedStrokePath) and cached here after: coarse `path` is
   * set once by buildWorld and never changes again, so `mergedPath` never needs
   * rebuilding once built. `mergedFullPath` is reset to null by attachFullDetail (the one
   * event that actually changes `fullPath` data), forcing one lazy rebuild the next time
   * it's needed — "rebuild only if the world data is rebuilt". Stroking one merged path
   * once, instead of every country individually, is what keeps borders cheap enough to
   * draw during a fast frame (renderer.ts) — a shared border between two touching
   * countries is traced twice, which a single uniform stroke colour makes invisible.
   */
  mergedPath: Path2D | null;
  mergedFullPath: Path2D | null;
}
