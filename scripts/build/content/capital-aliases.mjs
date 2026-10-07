import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { root } from './config.mjs';
import { normaliseAlias } from './normalise.mjs';

/**
 * `capitalAliases` on each country record: every name the "Name the Capital" quiz accepts.
 * The authored capital, plus the curated alternates in content/geography/capital-aliases.yaml
 * (Kyiv/Kiev, Astana/Nur-Sultan, the three South African capitals, ...) — see that file's
 * header for why GeoNames' own `altName` field is not a source (empty for 196 of 197).
 * Matching (case, diacritics, apostrophes, punctuation) is app/features/countries/names.ts's
 * normaliseName, unchanged — this only decides the candidate set, then guards it.
 *
 * COLLISION CHECK, same rule as country aliases: one normalised name may belong to only ONE
 * country. Unlike country aliases (which silently drop an ambiguous one) this THROWS — a
 * capital alias is hand-written, so an ambiguity is a mistake to fix, not data to filter.
 */
export function buildCapitalAliases(countries) {
  const capitalAliasDoc = parse(readFileSync(join(root, 'content', 'geography', 'capital-aliases.yaml'), 'utf8')) ?? {};
  const capitalAliasEntries = new Map(); // iso3 -> extra names
  for (const entry of capitalAliasDoc.aliases ?? []) {
    const where = 'content/geography/capital-aliases.yaml';
    const country = countries.find(c => c.name === entry.country);
    if (!country) throw new Error(`${where}: "${entry.country}" is not a known country name`);
    if (!String(entry.note ?? '').trim()) throw new Error(`${where}: "${entry.country}" needs a non-empty note`);
    if (!Array.isArray(entry.add) || !entry.add.length) throw new Error(`${where}: "${entry.country}" needs a non-empty add list`);
    if (capitalAliasEntries.has(country.iso3)) throw new Error(`${where}: "${entry.country}" appears twice`);
    capitalAliasEntries.set(country.iso3, entry.add.map(String));
  }

  /**
   * THE COUNTRY-NAME RULE: a capital alias may not equal the country's own name, or any of its
   * own aliases, after normalisation — typing the country in a capitals quiz must never score.
   * The exception is a capital that genuinely IS the country's name (Monaco, Singapore, San
   * Marino, Vatican City, Luxembourg, Djibouti): there the answer and the name coincide and there
   * is nothing to do about it. Throws, like the collision check below, because a capital alias
   * is hand-written and a violation is a mistake to fix. "Guatemala" for Guatemala City fails
   * this; "Washington" for the United States and "Brussel" for Belgium do not.
   */
  const capitalIsCountryName = country => normaliseAlias(country.capital) === normaliseAlias(country.name);
  function assertNotCountryName(country, name) {
    if (capitalIsCountryName(country)) return;
    const key = normaliseAlias(name);
    const own = [country.name, ...country.aliases].some(n => normaliseAlias(n) === key);
    if (own) {
      throw new Error(
        `content/geography/capital-aliases.yaml: "${name}" is ${country.name}'s own name or alias, so ` +
          `it can't also be accepted as its capital ("${country.capital}") — typing the country would score`
      );
    }
  }

  const capitalClaimedBy = new Map(); // normalised name -> Set of iso3
  for (const country of countries) {
    const extras = capitalAliasEntries.get(country.iso3) ?? [];
    for (const name of extras) assertNotCountryName(country, name);
    const names = [country.capital, ...extras];
    const kept = [];
    for (const name of names) {
      const key = normaliseAlias(name);
      if (!key) throw new Error(`capital aliases: "${name}" (${country.iso3}) normalises to nothing`);
      if (!capitalClaimedBy.has(key)) capitalClaimedBy.set(key, new Set());
      capitalClaimedBy.get(key).add(country.iso3);
      if (!kept.some(k => normaliseAlias(k) === key)) kept.push(name); // "Ulan-Bator" adds nothing to "Ulan Bator"
    }
    country.capitalAliases = kept;
  }
  const capitalCollisions = [...capitalClaimedBy].filter(([, isos]) => isos.size > 1);
  if (capitalCollisions.length) {
    throw new Error(
      'capital aliases: a normalised city name maps to more than one country:\n  ' +
        capitalCollisions.map(([key, isos]) => `"${key}" -> ${[...isos].join(', ')}`).join('\n  ')
    );
  }
  const totalCapitalAliases = countries.reduce((sum, c) => sum + c.capitalAliases.length - 1, 0);

  return { totalCapitalAliases, capitalAliasEntries };
}
