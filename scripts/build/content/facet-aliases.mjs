import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { root } from './config.mjs';
import { normaliseAlias } from './normalise.mjs';

/**
 * `currencyAliases`, `languageAliases` and `religionAliases` on each country record: every
 * string the "Name the Currency / Language / Religion" quizzes accept. Unlike capitals the
 * answer is NOT unique — twenty countries are "Euro" — so a name may legitimately belong to
 * many countries, and there is no cross-country collision check. The alias files are
 * therefore keyed by VALUE (one entry per currency name / language / religion, applying to
 * every country that has it), not by country: content/geography/{currency,language,religion}-aliases.yaml,
 * `- value: Spanish / add: [Castilian] / note: ...`. Each entry's value must exist in the data
 * (a typo or an upstream rename fails the build), and per facet an alias must be non-empty,
 * not repeat another alias (within or across entries), and not equal any value's own name.
 *
 * What a country accepts: currency = its name + its ISO code + the aliases of its name;
 * language = every entry of `languages` + their aliases (many countries have several official
 * languages); religion = the value, each " / "-separated component of it, + their aliases.
 * Broader religion terms are rejected at match time (app/features/countries/names.ts), which owns
 * the BROADER taxonomy; a unit test asserts it over this very data.
 */
export function addFacetAliases(countries) {
  function loadValueAliases(facet, knownValues) {
    const where = `content/geography/${facet}-aliases.yaml`;
    const doc = parse(readFileSync(join(root, 'content', 'geography', `${facet}-aliases.yaml`), 'utf8')) ?? {};
    const byValue = new Map(); // value -> extra names
    const claimed = new Map(); // normalised alias -> value that owns it
    const ownNames = new Set([...knownValues].map(normaliseAlias));
    for (const entry of doc.aliases ?? []) {
      if (!knownValues.has(entry.value)) throw new Error(`${where}: "${entry.value}" is not a ${facet} in the data`);
      if (!String(entry.note ?? '').trim()) throw new Error(`${where}: "${entry.value}" needs a non-empty note`);
      if (!Array.isArray(entry.add) || !entry.add.length) throw new Error(`${where}: "${entry.value}" needs a non-empty add list`);
      if (byValue.has(entry.value)) throw new Error(`${where}: "${entry.value}" appears twice`);
      for (const alias of entry.add.map(String)) {
        const key = normaliseAlias(alias);
        if (!key) throw new Error(`${where}: alias "${alias}" (${entry.value}) is empty after normalisation`);
        if (ownNames.has(key)) throw new Error(`${where}: alias "${alias}" (${entry.value}) is already some ${facet}'s own name`);
        if (claimed.has(key)) throw new Error(`${where}: alias "${alias}" (${entry.value}) is duplicated — also under "${claimed.get(key)}"`);
        claimed.set(key, entry.value);
      }
      byValue.set(entry.value, entry.add.map(String));
    }
    return value => byValue.get(value) ?? [];
  }
  const uniqueByKey = names => {
    const seen = new Set();
    return names.filter(n => {
      const key = normaliseAlias(n);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const religionParts = value => value.split(' / ');
  const currencyAliasesOf = loadValueAliases('currency', new Set(countries.map(c => c.currencyName).filter(Boolean)));
  const languageAliasesOf = loadValueAliases('language', new Set(countries.flatMap(c => c.languages)));
  const religionAliasesOf = loadValueAliases('religion', new Set(countries.flatMap(c => religionParts(c.religion))));
  for (const country of countries) {
    country.currencyAliases = country.currencyName
      ? uniqueByKey([country.currencyName, country.currencyCode, ...currencyAliasesOf(country.currencyName)])
      : [];
    country.languageAliases = uniqueByKey(country.languages.flatMap(l => [l, ...languageAliasesOf(l)]));
    country.religionAliases = country.religion
      ? uniqueByKey([country.religion, ...religionParts(country.religion).flatMap(r => [r, ...religionAliasesOf(r)])])
      : [];
  }
}
