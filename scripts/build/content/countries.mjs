import { require, SYNTHETIC_IDS } from './config.mjs';
import { familyOf, religionGroup } from './language-families.mjs';

export const wc = require('world-countries');

/**
 * Joins the authored YAML against world-countries (and a population fallback) into one
 * record per country, applying `override:` and `disputed:` blocks.
 */
export function buildCountries(authored) {
  const popFallback = Object.fromEntries(
    require('country-json/src/country-by-population.json').map(r => [r.country, r.population])
  );

  /**
   * `override:` in a country's YAML closes a gap in the upstream dataset — see e.g.
   * micronesia.yaml, where world-countries ships `currencies: {}` for FSM even though the
   * Compact of Free Association makes the US dollar sole legal tender. A shallow merge onto
   * the built record, validated so a typo or an unjustified override fails the build rather
   * than silently doing nothing or drifting unnoticed. See CLAUDE.md's Content conventions
   * for what an override is (and is not) for.
   */
  const overriddenFields = [];
  function applyOverride(record, a, where) {
    if (!a.override) return record;
    const { note, ...fields } = a.override;
    if (!note || !String(note).trim()) {
      throw new Error(`${where}: override block needs a non-empty "note" explaining why upstream is wrong`);
    }
    for (const key of Object.keys(fields)) {
      if (!(key in record)) {
        throw new Error(`${where}: override key "${key}" is not a field on the country record`);
      }
      record[key] = fields[key];
      overriddenFields.push(`${record.iso3}.${key}`);
    }
    return record;
  }

  /** Mirrors app/features/countries/mastery.ts's FACETS. Kept as a separate literal because this
   *  build script runs as plain Node and can't import a .ts module through the `~` alias —
   *  if you add a facet there, add it here too. */
  const FACETS = ['location', 'capital', 'flag', 'currency', 'language', 'religion', 'borders', 'outline'];

  /**
   * `disputed:` in a country's YAML marks a facet as genuinely contested rather than picking
   * a source and asserting precision nobody has (see Nigeria's religion — CLAUDE.md's
   * Content conventions). Same validation shape as override: a non-empty reason is
   * mandatory, and the facet name must be real. The effect lives in
   * app/features/countries/mastery.ts (applicableFacets excludes it) and questions.ts (never
   * generates a question from it) — this function only records it onto the record.
   */
  const disputedFacets = [];
  function applyDisputed(record, a, where) {
    if (!a.disputed) return record;
    for (const [facet, reason] of Object.entries(a.disputed)) {
      if (!FACETS.includes(facet)) {
        throw new Error(`${where}: disputed key "${facet}" is not a recognised facet`);
      }
      if (!reason || !String(reason).trim()) {
        throw new Error(`${where}: disputed.${facet} needs a non-empty reason`);
      }
      record.disputed[facet] = String(reason).trim();
      disputedFacets.push(`${record.iso3}.${facet}`);
    }
    return record;
  }

  const countries = [];
  for (const c of wc) {
    const a = authored[c.cca3];
    if (!a) continue;
    const languages = Object.values(c.languages || {});
    const currencyCode = Object.keys(c.currencies || {})[0] || null;
    const currency = currencyCode ? c.currencies[currencyCode] : null;
    const population = a.population ?? popFallback[c.name.common] ?? 0;
    const record = {
      id: SYNTHETIC_IDS[c.name.common] ?? String(Number(c.ccn3)),
      iso3: c.cca3,
      iso2: c.cca2,
      slug: a.slug,
      name: c.name.common,
      officialName: c.name.official,
      emoji: c.flag,
      capital: (c.capital && c.capital[0]) || null,
      currencyCode,
      currencyName: currency?.name ?? null,
      currencySymbol: currency?.symbol ?? '',
      population,
      area: c.area,
      density: c.area ? population / c.area : 0,
      languages,
      language: languages[0] ?? null,
      languageFamily: familyOf(languages[0]),
      religion: a.religion,
      religionGroup: religionGroup(a.religion),
      borders: (c.borders || []).filter(b => authored[b]),
      landlocked: !!c.landlocked,
      latlng: c.latlng,
      region: c.region,
      subregion: c.subregion,
      hook: a.hook,
      flagDescription: a.flag,
      outlineDescription: a.outline,
      disputed: {}
    };
    const where = `content/geography/countries/${a.slug}.yaml`;
    countries.push(applyDisputed(applyOverride(record, a, where), a, where));
  }

  const missing = Object.keys(authored).filter(iso3 => !countries.some(c => c.iso3 === iso3));
  if (missing.length) throw new Error(`authored countries with no ISO record: ${missing.join(', ')}`);

  return { countries, overriddenFields, disputedFacets };
}
