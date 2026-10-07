/**
 * Content pipeline: content/geography/** -> public/data/geography/{world,world-coarse,
 * countries,slugs}.json
 *
 * Joins hand-authored YAML against two upstream datasets and emits the payloads the app
 * fetches at runtime. The output is committed so a deploy can never break because an
 * upstream package published a new version.
 *
 *   node scripts/build/build-content.mjs [--detail=0.02]
 *
 * Emits TWO geometry payloads, always: world.json at DETAIL (below; default 0, full
 * 1:10m, unsimplified) and world-coarse.json at a hardcoded COARSE_DETAIL (0.006) the map
 * renders from at world zoom, where full detail is sub-pixel — see CLAUDE.md's Performance
 * section for the measured detail/frame-time table this is based on, and
 * app/features/countries/world.ts / app/engines/map/topology.ts's attachFullDetail for how the two
 * are loaded and switched between at runtime. --detail only ever affects world.json,
 * which is what makes it useful for testing a specific "full" resolution (as the
 * Performance section's table did) without touching the coarse tier at all.
 *
 * This file is only the entry point; each job lives in scripts/build/content/ (config, authored
 * content, country records, aliases, places, geometry, lakes, halos, flags, emit, report).
 */
import { DETAIL, COARSE_DETAIL } from './content/config.mjs';
import { loadAuthored } from './content/authored.mjs';
import { buildCountries } from './content/countries.mjs';
import { buildCountryAliases } from './content/aliases.mjs';
import { applyConfusableFlags } from './content/confusable.mjs';
import { buildPlaces } from './content/places.mjs';
import { buildCapitalAliases } from './content/capital-aliases.mjs';
import { addFacetAliases } from './content/facet-aliases.mjs';
import { buildGeometry } from './content/geometry.mjs';
import { buildHalos } from './content/halos.mjs';
import { buildFlags } from './content/flags.mjs';
import { writeData } from './content/emit.mjs';
import { report } from './content/report.mjs';

const authored = loadAuthored();
const { countries, overriddenFields, disputedFacets } = buildCountries(authored);
const { totalAliases, droppedAliases, ambiguous, aliasOverrides } = buildCountryAliases(countries, authored);
const confusablePairCount = applyConfusableFlags(countries);
const places = buildPlaces(countries);
const { totalCapitalAliases, capitalAliasEntries } = buildCapitalAliases(countries);
addFacetAliases(countries);

const full = buildGeometry(countries, DETAIL);
const coarse = buildGeometry(countries, COARSE_DETAIL);
const { halos, haloOverNeighbour } = buildHalos(countries, full);
const { flagOverrides, wantedFlags, orphanedFlags, flagsBytes } = buildFlags(countries);
const { json, coarseJson, facts, noPolygon } = writeData({ full, coarse, places, halos, countries });

report({
  countries, overriddenFields, disputedFacets, aliasOverrides, totalAliases, droppedAliases, ambiguous,
  confusablePairCount, full, coarse, places, halos, haloOverNeighbour, totalCapitalAliases,
  capitalAliasEntries, flagOverrides, noPolygon, json, coarseJson, facts, wantedFlags, flagsBytes,
  orphanedFlags
});
