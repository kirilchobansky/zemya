/**
 * Country name matching for the "Name the Country" quiz.
 *
 * NO fuzzy matching, no edit distance. There is no penalty for a wrong attempt and no
 * limit on tries — a typo just means keep typing, and getting the spelling right is part
 * of knowing the country. Do not "improve" this into a distance metric later: that would
 * let "Frnace" pass as "France", which defeats the point of a spelling-and-recall quiz.
 */
import type { CountryRecord } from '~/lib/map/types';

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
