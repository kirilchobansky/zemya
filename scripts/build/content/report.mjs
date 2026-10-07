import { ABSORB, DETAIL, COARSE_DETAIL } from './config.mjs';

/** The summary build-content prints. */
export function report(r) {
  const {
    countries, overriddenFields, disputedFacets, aliasOverrides, totalAliases, droppedAliases, ambiguous,
    confusablePairCount, full, coarse, places, halos, haloOverNeighbour, totalCapitalAliases,
    capitalAliasEntries, flagOverrides, noPolygon, json, coarseJson, facts, wantedFlags, flagsBytes,
    orphanedFlags
  } = r;
  console.log(`countries      ${countries.length}`);
  console.log(
    `overrides      ${new Set(overriddenFields.map(f => f.split('.')[0])).size}` +
      (overriddenFields.length ? ` (${overriddenFields.join(', ')})` : '')
  );
  console.log(
    `disputed       ${new Set(disputedFacets.map(f => f.split('.')[0])).size}` +
      (disputedFacets.length ? ` (${disputedFacets.join(', ')})` : '')
  );
  console.log(
    `alias edits    ${aliasOverrides.length}${aliasOverrides.length ? ` (${aliasOverrides.join(', ')})` : ''}`
  );
  console.log(
    `aliases        ${totalAliases}` +
      (droppedAliases ? ` (${droppedAliases} dropped as ambiguous: ${ambiguous.map(([key]) => key).join(', ')})` : '')
  );
  console.log(`confusable     ${confusablePairCount} pair(s)`);
  console.log(
    `absorbed       ${Object.keys(ABSORB).length} ` +
      `(${Object.entries(ABSORB).map(([name, iso3]) => `${name}->${iso3}`).join(', ')})`
  );
  console.log(`arcs (full)    ${full.arcs.length} (${full.totalPoints.toLocaleString()} points)`);
  console.log(`arcs (coarse)  ${coarse.arcs.length} (${coarse.totalPoints.toLocaleString()} points)`);
  console.log(`detail (full)  ${DETAIL || '0 — unsimplified; nothing filtered, small islands render'}`);
  console.log(`detail (coarse) ${COARSE_DETAIL}`);
  console.log(`geometries     ${full.geometries.length}`);
  console.log(`lakes          ${full.lakes.length} (${full.lakes.map(l => l.id).join(', ')})`);
  console.log(`places         ${places.length} (capitals)`);
  console.log(`halos          ${halos.length} (${halos.map(h => countries.find(c => c.id === h.id).iso3).join(', ')})${haloOverNeighbour.length ? `; dot instead, halo would cover a neighbour: ${haloOverNeighbour.join(', ')}` : ''}`);
  console.log(`capital aliases ${totalCapitalAliases} extra across ${capitalAliasEntries.size} countries`);
  console.log(
    `facet aliases   currency ${countries.reduce((n, c) => n + Math.max(0, c.currencyAliases.length - 2), 0)}, ` +
      `language ${countries.reduce((n, c) => n + Math.max(0, c.languageAliases.length - c.languages.length), 0)}, ` +
      `religion ${countries.reduce((n, c) => n + Math.max(0, c.religionAliases.length - 1), 0)} extra (per-country sums)`
  );
  console.log(
    `flag overrides ${flagOverrides.size}` +
      (flagOverrides.size ? ` (${[...flagOverrides.keys()].map(k => k.toUpperCase()).join(', ')})` : '')
  );
  console.log(`no polygon     ${noPolygon.length ? noPolygon.join(', ') : 'none'}`);
  console.log(`world.json     ${(json.length / 1024).toFixed(0)} KB`);
  console.log(`world-coarse   ${(coarseJson.length / 1024).toFixed(0)} KB`);
  console.log(`countries.json ${(facts.length / 1024).toFixed(0)} KB`);
  console.log(
    `flags          ${wantedFlags.size} (${(flagsBytes / (1024 * 1024)).toFixed(1)} MB)` +
      (orphanedFlags ? `, removed ${orphanedFlags} orphan(s)` : '')
  );
}
