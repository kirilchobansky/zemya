/**
 * Pure search over the Bulgaria history timeline (app/features/history/components/HistorySearch.tsx) — no
 * React, no canvas. Case-insensitive substring match against name, aliases (Cyrillic and
 * Latin — see catalog.server.ts), role and tags; cheap enough over ~700 entries to run on
 * every keystroke with no debounce.
 *
 * Ranking, best first: name starts with the query, then name contains it, then an alias
 * matches, then a tag or role matches — a match at a coarser tier never loses to one at a
 * finer tier regardless of where in the string it falls. Ties (same tier) go to the
 * earlier date, so a period search doesn't surface a stray 20th-century event first.
 *
 * A query typed in Latin letters ("shishman") also matches Cyrillic text ("Шишман"):
 * rather than transliterating every entry's name/aliases/role/tags to Latin up front (which
 * would need to pick ONE spelling per ambiguous Cyrillic letter and could guess wrong), the
 * query itself is compiled into a regular expression over Cyrillic letters — each Latin
 * token expands to every Cyrillic letter it could stand for (see LATIN_TO_CYRILLIC) — and
 * that regex is matched against the original Cyrillic text. A pure-Cyrillic query passes
 * through unchanged (no Latin token matches, so every character falls back to itself),
 * which is why the plain substring checks below still run first rather than being replaced.
 */
import type { TimelineEntry } from '../timeline/renderer';

const TIER_NAME_STARTS = 0;
const TIER_NAME_CONTAINS = 1;
const TIER_ALIAS = 2;
const TIER_TAG_OR_ROLE = 3;

/** Multi-letter Latin digraphs/trigraphs, longest first so e.g. "sht" is consumed whole
 *  rather than as "sh" + "t". Each maps to the one Cyrillic letter it's a variant spelling
 *  of — see CLAUDE.md-linked search brief for the accepted variant list. */
const LATIN_GROUPS_BY_LENGTH: readonly { length: number; map: Readonly<Record<string, readonly string[]>> }[] = [
  { length: 3, map: { sht: ['щ'] } },
  {
    length: 2,
    map: {
      zh: ['ж'], ts: ['ц'], ch: ['ч'], sh: ['ш'], kh: ['х'],
      yu: ['ю'], iu: ['ю'], ya: ['я'], ia: ['я']
    }
  }
];

/** Single-Latin-letter fallback, tried once no digraph/trigraph matches at this position.
 *  Several Cyrillic letters commonly share one Latin letter (а/ъ both "a", и/й both "i") —
 *  the resulting class matches either, which is a deliberately loose match for a search
 *  box, not a disambiguation. */
const SINGLE_LATIN_TO_CYRILLIC: Readonly<Record<string, readonly string[]>> = {
  a: ['а', 'ъ'], b: ['б'], v: ['в'], g: ['г'], d: ['д'], e: ['е'], z: ['з'],
  i: ['и', 'й'], j: ['й', 'ж'], k: ['к'], l: ['л'], m: ['м'], n: ['н'], o: ['о'],
  p: ['п'], r: ['р'], s: ['с'], t: ['т'], u: ['у', 'ъ'], f: ['ф'], h: ['х'],
  c: ['ц'], y: ['й']
};

function escapeRegExpChar(ch: string): string {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

function classFor(letters: readonly string[]): string {
  return letters.length > 1 ? `(?:${letters.join('|')})` : letters[0];
}

/** Compiles a Latin query into a regex-source string over Cyrillic letters — see the
 *  module header. Returns null for an empty query (nothing to build). */
function translitPatternSource(query: string): string | null {
  if (!query) return null;
  let out = '';
  let i = 0;
  outer: while (i < query.length) {
    for (const { length, map } of LATIN_GROUPS_BY_LENGTH) {
      const chunk = query.slice(i, i + length);
      const group = chunk.length === length ? map[chunk] : undefined;
      if (group) {
        out += classFor(group);
        i += length;
        continue outer;
      }
    }
    const single = SINGLE_LATIN_TO_CYRILLIC[query[i]];
    out += single ? classFor(single) : escapeRegExpChar(query[i]);
    i += 1;
  }
  return out;
}

/** A Latin query compiled into a regex over Cyrillic letters, for callers that need to test
 *  it against a WHOLE name (the fill-the-list quiz, fill-quiz.ts) rather than a substring.
 *  `whole: true` anchors both ends; `false` anchors only the start (a prefix test). Same
 *  compilation as the search box — one Latin letter/digraph expands to every Cyrillic letter
 *  it could stand for. Null for an empty query. Pass an already-lower-cased query. */
export function latinToCyrillicRegExp(query: string, whole = true): RegExp | null {
  const source = translitPatternSource(query);
  if (!source) return null;
  return new RegExp(whole ? `^(?:${source})$` : `^(?:${source})`);
}

function tierFor(entry: TimelineEntry, q: string, startsRe: RegExp | null, containsRe: RegExp | null): number | null {
  const name = entry.label.toLowerCase();
  if (name.startsWith(q) || (startsRe && startsRe.test(name))) return TIER_NAME_STARTS;
  if (name.includes(q) || (containsRe && containsRe.test(name))) return TIER_NAME_CONTAINS;
  if (entry.aliases.some(a => { const al = a.toLowerCase(); return al.includes(q) || (containsRe && containsRe.test(al)); })) {
    return TIER_ALIAS;
  }
  const roleMatches =
    entry.role != null &&
    (() => { const r = entry.role!.toLowerCase(); return r.includes(q) || (containsRe && containsRe.test(r)); })();
  if (roleMatches || entry.tags.some(t => { const tl = t.toLowerCase(); return tl.includes(q) || (containsRe && containsRe.test(tl)); })) {
    return TIER_TAG_OR_ROLE;
  }
  return null;
}

export function search(entries: readonly TimelineEntry[], query: string, limit = 8): TimelineEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const patternSource = translitPatternSource(q);
  const startsRe = patternSource ? new RegExp(`^(?:${patternSource})`) : null;
  const containsRe = patternSource ? new RegExp(patternSource) : null;

  const scored: { entry: TimelineEntry; tier: number }[] = [];
  for (const entry of entries) {
    const tier = tierFor(entry, q, startsRe, containsRe);
    if (tier !== null) scored.push({ entry, tier });
  }
  scored.sort((a, b) => a.tier - b.tier || a.entry.start - b.entry.start);
  return scored.slice(0, limit).map(s => s.entry);
}
