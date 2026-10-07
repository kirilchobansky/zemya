import { normaliseAlias } from './normalise.mjs';
import { wc } from './countries.mjs';

/**
 * Every string a user could reasonably type to name a country in the "Name the Country"
 * quiz, sourced from world-countries' altSpellings plus its own common and official name
 * — it already covers the hard cases (Burma/Myanmar, Swaziland/Eswatini, East Timor/
 * Timor-Leste, Holland/Netherlands, DRC, UAE, Ivory Coast/Côte d'Ivoire, Macedonia)
 * without hand-writing a list from memory. Two-letter ISO codes are dropped — they are
 * not names and they collide ("US", "GB", "CI") — non-Latin spellings are kept for free.
 * Matching itself (case, diacritics, punctuation) lives in app/features/countries/names.ts;
 * this only decides the candidate set and guards against ambiguity, since a normalised
 * alias that maps to two different countries must never resolve to whichever one was
 * parsed first.
 */
export function buildCountryAliases(countries, authored) {
  const aliasSources = new Map(); // iso3 -> raw alias strings, deduped, before the collision check
  for (const c of wc) {
    if (!authored[c.cca3]) continue;
    const raw = [...(c.altSpellings || []), c.name.common, c.name.official];
    aliasSources.set(c.cca3, [...new Set(raw.filter(s => s && s.trim().length > 2))]);
  }

  // normalised alias -> every iso3 that claims it, across the whole catalogue
  const claimedBy = new Map();
  for (const [iso3, aliases] of aliasSources) {
    for (const alias of aliases) {
      const key = normaliseAlias(alias);
      if (!key) continue;
      if (!claimedBy.has(key)) claimedBy.set(key, new Set());
      claimedBy.get(key).add(iso3);
    }
  }
  // ambiguous means two DIFFERENT countries claim the same normalised form — the same
  // country listing a spelling twice (common name === an altSpelling) does not count
  const ambiguous = [...claimedBy.entries()].filter(([, isos]) => isos.size > 1);
  const ambiguousKeys = new Set(ambiguous.map(([key]) => key));

  let totalAliases = 0;
  let droppedAliases = 0;
  for (const country of countries) {
    const kept = [];
    for (const alias of aliasSources.get(country.iso3) ?? []) {
      if (ambiguousKeys.has(normaliseAlias(alias))) {
        droppedAliases += 1;
        continue;
      }
      kept.push(alias);
    }
    country.aliases = kept;
    totalAliases += kept.length;
  }

  /**
   * Per-country alias edits, from the country's YAML:
   *
   *   aliases:
   *     note: why the generated list is wrong or too narrow (mandatory)
   *     add: [UK]        accepted in addition; skips the length and ambiguity filters above
   *     remove: [Thai]   no longer accepted
   *
   * Applied AFTER the ambiguity guard, on purpose: an added alias may be shared by two
   * countries ("Congo" is right for either Congo), which the guard would otherwise strip
   * from both. The quiz only ever checks a typed name against the current target, so a
   * shared alias is never resolved to "whichever country came first". `remove` must name an
   * alias that is actually there, so an upstream rename fails the build instead of silently
   * leaving the override doing nothing.
   */
  const aliasOverrides = [];
  for (const country of countries) {
    const spec = authored[country.iso3].aliases;
    if (!spec) continue;
    const where = `content/geography/countries/${authored[country.iso3].slug}.yaml`;
    if (!String(spec.note ?? '').trim()) throw new Error(`${where}: aliases needs a non-empty note`);
    const kept = [...country.aliases];
    for (const alias of spec.remove ?? []) {
      const at = kept.findIndex(a => normaliseAlias(a) === normaliseAlias(alias));
      if (at < 0) throw new Error(`${where}: aliases.remove "${alias}" is not one of ${country.name}'s aliases`);
      kept.splice(at, 1);
      aliasOverrides.push(`${country.iso3}-${alias}`);
    }
    for (const alias of spec.add ?? []) {
      if (!kept.some(a => normaliseAlias(a) === normaliseAlias(alias))) kept.push(alias);
      aliasOverrides.push(`${country.iso3}+${alias}`);
    }
    country.aliases = kept;
  }

  return { totalAliases, droppedAliases, ambiguous, aliasOverrides };
}
