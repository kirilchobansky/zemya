/**
 * Country name matching for the "Name the Country" quiz.
 *
 * (The "Name all countries" quiz is the one exception, at the bottom of this file: there is
 * no prompt to anchor an answer, so it forgives one typo — see `matchCountryName`.)
 *
 * NO fuzzy matching, no edit distance. There is no penalty for a wrong attempt and no
 * limit on tries — a typo just means keep typing, and getting the spelling right is part
 * of knowing the country. Do not "improve" this into a distance metric later: that would
 * let "Frnace" pass as "France", which defeats the point of a spelling-and-recall quiz.
 */
import type { CountryRecord } from '~/lib/map/types';
import { latinToCyrillicRegExp } from '~/lib/history/search';
import { BULGARIAN_NAMES, REJECTED_SPELLINGS } from './names-bg';
import { religionChain } from './questions';

/** lowercase · strip diacritics (NFD + remove combining marks) · strip apostrophes
 *  outright (so "d'Ivoire" becomes "divoire", not "d ivoire") · every other run of
 *  punctuation/whitespace collapses to a single space · trim.
 *
 *  Punctuation is stripped with the Unicode `\p{L}`/`\p{N}` (letter/number) categories,
 *  not an `a-z0-9` range — a plain ASCII range would treat every Armenian, Cyrillic or
 *  CJK character as "punctuation" and silently erase it, which would make a country's
 *  own non-Latin aliases (kept on purpose — see build-content.mjs) unmatchable by
 *  anyone actually typing them. */
export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’‘ʼ`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** True if `typed` is, after normalisation, exactly one of the country's aliases. */
export function matchesCountry(typed: string, country: CountryRecord): boolean {
  const normalisedTyped = normaliseName(typed);
  if (!normalisedTyped) return false;
  return country.aliases.some(alias => normaliseName(alias) === normalisedTyped);
}

/** True if `typed` is, after normalisation, exactly one of the names accepted for the
 *  country's capital (see CountryRecord.capitalAliases). Same exact-after-normalisation
 *  rule as matchesCountry, and for the same reason: no fuzzy matching. */
export function matchesCapital(typed: string, country: CountryRecord): boolean {
  const normalisedTyped = normaliseName(typed);
  if (!normalisedTyped) return false;
  return country.capitalAliases.some(alias => normaliseName(alias) === normalisedTyped);
}

/** Shared by the three facet matchers: exact after normalisation, against a list. */
function matchesAny(typed: string, accepted: string[]): boolean {
  const normalisedTyped = normaliseName(typed);
  if (!normalisedTyped) return false;
  return accepted.some(name => normaliseName(name) === normalisedTyped);
}

/** The currency's full name, its ISO code, or a curated alternate (currency-aliases.yaml).
 *  Never a bare "dollar"/"franc"/"peso": the alias file lists none, and the build refuses
 *  an alias equal to some currency's own name. */
export function matchesCurrency(typed: string, country: CountryRecord): boolean {
  return matchesAny(typed, country.currencyAliases);
}

/** ANY of the country's languages (not just the alphabetically first) or an alias of one. */
export function matchesLanguage(typed: string, country: CountryRecord): boolean {
  return matchesAny(typed, country.languageAliases);
}

/** The authored value, a component of a compound one, or a synonym that keeps the
 *  distinction (religion-aliases.yaml) — and NEVER a broader term for a more specific value:
 *  "Islam" for Sunni Islam, "Christianity" for Roman Catholicism. The alias list already
 *  leaves those out; this re-checks against the BROADER taxonomy (questions.ts) so a stray
 *  alias can't slip one in. A component that is itself the broad term ("Christianity" in
 *  "Christianity / Hinduism") accepts it. */
export function matchesReligion(typed: string, country: CountryRecord): boolean {
  if (!matchesAny(typed, country.religionAliases)) return false;
  const key = normaliseName(typed);
  const components = country.religion.split(' / ');
  if (components.some(c => normaliseName(c) === key)) return true;
  const isBroaderThanOwn = components.some(c =>
    religionChain(c).slice(1).some(ancestor => normaliseName(ancestor) === key)
  );
  return !isBroaderThanOwn;
}

// ------------------------------------------------------------------ "Name all countries"

/** Shortest name (letters only) that may be matched with one typo — the fill quiz's number. */
const MIN_TYPO_LETTERS = 6;

/** The comparison form: `normaliseName` with the spaces gone, so "united states" and
 *  "unitedstates" are one spelling (and a Latin query compiles to one Cyrillic run). */
const squash = (value: string): string => normaliseName(value).replace(/ /g, '');

export interface PreparedCountryName {
  iso3: string;
  /** Every spelling the country is named by, squashed, minus the ambiguous ones. */
  forms: readonly string[];
  /** Squashed spellings that name nobody here, however close (REJECTED_SPELLINGS). */
  rejected: readonly string[];
}

/** Compiles each country's typeable forms once: its name, official name and every alias
 *  (English, and Bulgarian from names-bg.ts). A form that two countries share is never accepted — typing it
 *  names nobody — except where it is exactly one country's own `name`, which then keeps it
 *  ("Congo" is the Republic of the Congo's name and only an alias of the other). */
export function prepareCountryNames(countries: readonly CountryRecord[]): PreparedCountryName[] {
  const owners = new Map<string, Set<string>>();
  const ownName = new Map<string, Set<string>>();
  const formsOf = countries.map(c => {
    const forms = new Set([c.name, c.officialName, ...c.aliases, ...(BULGARIAN_NAMES[c.iso3] ?? [])].map(squash).filter(f => f.length >= 2));
    for (const form of forms) (owners.get(form) ?? owners.set(form, new Set()).get(form)!).add(c.iso3);
    const own = squash(c.name);
    (ownName.get(own) ?? ownName.set(own, new Set()).get(own)!).add(c.iso3);
    return forms;
  });
  return countries.map((c, i) => ({
    iso3: c.iso3,
    rejected: (REJECTED_SPELLINGS[c.iso3] ?? []).map(squash),
    forms: [...formsOf[i]].filter(form => {
      const claimed = ownName.get(form);
      const holders = claimed?.size === 1 ? claimed : owners.get(form)!;
      return holders.size === 1 && holders.has(c.iso3);
    })
  }));
}

export interface CountryNameMatch {
  /** Index into the prepared list. */
  index: number;
  /** Accept without waiting for Enter: an exact match no longer unfilled name starts with. */
  instant: boolean;
  /** Matched through the one-typo allowance (never instant). */
  typo: boolean;
  /** The country was already named — a hint, not an error, and nothing is filled. */
  already: boolean;
}

/** True when `a` and `b` differ by exactly one insertion, deletion or substitution. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/**
 * Which country does `typed` name, if any? Exact forms first (Latin letters also match a
 * Cyrillic form, through the history search's Latin-to-Cyrillic compilation); a text that
 * could be two countries names none. Without an exact match, one typo is allowed against a
 * name of 6+ letters — only when exactly one country (named or not) is that close, so a
 * typo never picks between two. Names in `named` are matched too, flagged `already`.
 * `instant` is false while a longer, still unnamed country starts with the text
 * ("Niger" while Nigeria is open), so the player can keep typing; Enter takes it anyway.
 */
export function matchCountryName(
  typed: string,
  prepared: readonly PreparedCountryName[],
  named: ReadonlySet<string>
): CountryNameMatch | null {
  const t = squash(typed);
  if (!t) return null;
  const latin = /[a-z]/.test(t);
  const whole = latin ? latinToCyrillicRegExp(t, true) : null;
  const prefix = latin ? latinToCyrillicRegExp(t, false) : null;

  const allowed = (p: PreparedCountryName) => !p.rejected.includes(t);
  let hits = prepared.flatMap((p, i) => (p.forms.includes(t) ? [i] : []));
  if (hits.length === 0 && whole) hits = prepared.flatMap((p, i) => (allowed(p) && p.forms.some(f => whole.test(f)) ? [i] : []));
  if (hits.length > 1) return null; // ambiguous: rejected, never guessed
  if (hits.length === 1) {
    const index = hits[0];
    const longerOpen = prepared.some((p, i) =>
      i !== index && !named.has(p.iso3) &&
      p.forms.some(f => f.length > t.length && (f.startsWith(t) || (prefix !== null && prefix.test(f))))
    );
    return { index, instant: !longerOpen, typo: false, already: named.has(prepared[index].iso3) };
  }

  const near = prepared.flatMap((p, i) =>
    allowed(p) && p.forms.some(f => f.replace(/\d/g, '').length >= MIN_TYPO_LETTERS && oneEditApart(t, f)) ? [i] : []
  );
  if (near.length !== 1) return null;
  return { index: near[0], instant: false, typo: true, already: named.has(prepared[near[0]].iso3) };
}
