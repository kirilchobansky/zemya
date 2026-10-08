/**
 * Matching half of the "Fill the list" quiz (see fill-quiz.ts for the overview): normalisation,
 * the accepted forms of an entry and `matchFill`. Pure logic, relative imports only — it is
 * loaded outside the app's bundler like fill-quiz.ts itself.
 */
import { latinToCyrillicRegExp } from '../../history/data/search';

export type FillKind = 'ruler' | 'government';

/** Words that are a title, not part of a name — dropped from typed text and names alike. */
const TITLE_WORDS: ReadonlySet<string> = new Set(['хан', 'княз', 'цар', 'khan', 'prince', 'tsar']);

/** Shortest name (letters only, digits excluded) that may be matched with one typo. */
const MIN_TYPO_LETTERS = 6;

const ROMAN = /^(?:x{0,3})(?:ix|iv|v?i{0,3})$/;
const ROMAN_VALUES: Readonly<Record<string, number>> = { i: 1, v: 5, x: 10 };

function romanToNumber(token: string): number | null {
  if (!token || !ROMAN.test(token)) return null;
  let total = 0;
  for (let i = 0; i < token.length; i++) {
    const v = ROMAN_VALUES[token[i]];
    const next = ROMAN_VALUES[token[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

/** Lower-cased words of `text`: title words dropped, a Roman numeral (any word after the
 *  first) rewritten as Arabic, everything that isn't a letter or digit removed. */
function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[\s.\-–—]+/)) {
    const word = raw.replace(/[^\p{L}\p{N}]/gu, '');
    if (!word || TITLE_WORDS.has(word)) continue;
    const numeral = out.length > 0 ? romanToNumber(word) : null;
    out.push(numeral === null ? word : String(numeral));
  }
  return out;
}

/** The canonical comparison form of `text` — see the module header. */
export function normaliseFill(text: string): string {
  return tokens(text).join('');
}

const isNumeralToken = (t: string): boolean => /^\d+$/.test(t);

/** The Roman/Arabic-normalised words of one name, and where its numeral is (-1: none). */
function parts(name: string): { toks: string[]; at: number } {
  const toks = tokens(name);
  return { toks, at: toks.findIndex((t, i) => i > 0 && isNumeralToken(t)) };
}

/** The last non-numeral word of a name of two or more words — its surname — or null. */
function surnameOf({ toks, at }: { toks: string[]; at: number }): string | null {
  const words = toks.filter((_, i) => i !== at);
  return words.length >= 2 ? words[words.length - 1] : null;
}

// ---------------------------------------------------------------------------- matching

export interface FillEntry {
  id: string;
  kind: FillKind;
  /** Display name: name[lang] of the country, the other language if empty. */
  name: string;
  /** The name in the other language, accepted when typing ("" when none). */
  nameAlt: string;
  aliases: readonly string[];
  /** Skip the form cut at the numeral ("Георги I" of "Георги I Тертер"): only the whole name counts. */
  fullNameOnly?: boolean;
  /** Decimal years (scale.ts). `end` is null for an entry that is still ongoing. */
  start: number;
  end: number | null;
  /** The authored date strings, for the dd.mm.yyyy tooltip. */
  startRaw: string;
  endRaw: string | null;
  /** False when the office was not filled by a public vote (bg.yaml `elected`). */
  elected: boolean;
  /** The entry's role, parentheses removed ("хан", "княз, от 1908 цар"); "" when it has none. */
  title: string;
}

export interface PreparedFillEntry {
  id: string;
  forms: readonly string[];
  /** Numbered names without their number ("борис", "иванасен"): not accepted, but worth a hint. */
  bare: readonly string[];
}

/** Compile each entry's typeable forms once, not per keystroke. Keep the entries in
 *  chronological order: "earliest unfilled" means lowest index. */
export function prepareFill(entries: readonly FillEntry[]): PreparedFillEntry[] {
  const named = entries.map(e => [e.name, e.nameAlt].filter(Boolean).map(parts));
  // Each entry's candidate forms, and who it is: the same full name is the same person.
  const candidates = entries.map((e, i) => {
    const forms = new Set<string>();
    const bare = new Set<string>();
    for (const p of named[i]) {
      forms.add(p.toks.join(''));
      if (p.at > 0) {
        if (!e.fullNameOnly) forms.add(p.toks.slice(0, p.at + 1).join('')); // Симеон 1 (of Симеон I Велики)
        bare.add(p.toks.slice(0, p.at).join(''));
      }
      const sn = surnameOf(p);
      if (sn) forms.add(sn);
    }
    for (const a of e.aliases) forms.add(normaliseFill(a)); // exact spelling, nothing derived
    forms.delete('');
    bare.delete('');
    return { forms, bare, person: (named[i][0] ?? parts('')).toks.join('') };
  });
  // form -> the distinct people it belongs to; a form of two different people is never accepted
  const owners = new Map<string, Set<string>>();
  for (const c of candidates) for (const f of c.forms) {
    (owners.get(f) ?? owners.set(f, new Set()).get(f)!).add(c.person);
  }
  return entries.map((e, i) => {
    const forms = [...candidates[i].forms].filter(f => owners.get(f)!.size === 1);
    const bare = [...candidates[i].bare].filter(f => !forms.includes(f));
    return { id: e.id, forms, bare };
  });
}

export interface FillMatch {
  /** Index into the prepared list. */
  index: number;
  /** Accept without waiting for Enter: an exact match no longer name starts with. */
  instant: boolean;
  /** Matched through the one-typo allowance (never instant). */
  typo: boolean;
}

const digitsOf = (s: string): string => s.replace(/\D/g, '');
const lettersOf = (s: string): string => s.replace(/\d/g, '');

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
 * Which unfilled entry does `typed` fill, if any? Filled entries (ids in `filled`) are
 * ignored entirely. Exact matches win; when several unfilled entries match (Борис ->
 * Борис I, Борис II) the earliest fills. With no exact match, one typo is allowed against a
 * name of 6+ letters — but only if the typed text is not itself a name of ANY entry (filled
 * or not), the numeral is exactly right (Борис 1 must never become Борис 2), and exactly one
 * unfilled entry is that close, so a typo can never pick between two entries.
 * A typo also isn't tried for text typed in Latin letters: that compilation is a regex, not
 * a string.
 */
export function matchFill(
  typed: string,
  entries: readonly PreparedFillEntry[],
  filled: ReadonlySet<string>
): FillMatch | null {
  const t = normaliseFill(typed);
  if (!t) return null;
  const latin = /[a-z]/.test(t);
  const whole = latin ? latinToCyrillicRegExp(t, true) : null;
  const prefix = latin ? latinToCyrillicRegExp(t, false) : null;
  const isExact = (form: string): boolean => form === t || (whole !== null && whole.test(form));

  let target = -1;
  for (let i = 0; i < entries.length; i++) {
    if (!filled.has(entries[i].id) && entries[i].forms.some(isExact)) { target = i; break; }
  }

  if (target >= 0) {
    // A longer name that starts with what is typed means the player may not be done. The
    // target's own longer forms don't count: with only Борис II left, "Борис" is enough.
    const longerExists = entries.some((e, i) =>
      i !== target && !filled.has(e.id) &&
      e.forms.some(f => f.length > t.length && (f.startsWith(t) || (prefix !== null && prefix.test(f))))
    );
    return { index: target, instant: !longerExists, typo: false };
  }

  if (latin || lettersOf(t).length === 0) return null;
  if (entries.some(e => e.forms.some(isExact))) return null; // a filled entry's exact name
  const digits = digitsOf(t);
  const letters = lettersOf(t);
  const near: number[] = [];
  entries.forEach((e, i) => {
    if (filled.has(e.id)) return;
    const hit = e.forms.some(f => {
      const fl = lettersOf(f);
      return fl.length >= MIN_TYPO_LETTERS && digitsOf(f) === digits && oneEditApart(letters, fl);
    });
    if (hit) near.push(i);
  });
  return near.length === 1 ? { index: near[0], instant: false, typo: true } : null;
}

/** True when `typed` is a numbered name without its number ("Иван Асен") and fills nothing —
 *  the cue for the "Add the number" hint. */
export function needsNumber(
  typed: string,
  entries: readonly PreparedFillEntry[],
  filled: ReadonlySet<string>
): boolean {
  const t = normaliseFill(typed);
  if (!t || matchFill(typed, entries, filled)) return false;
  const whole = /[a-z]/.test(t) ? latinToCyrillicRegExp(t, true) : null;
  return entries.some(e => e.bare.some(f => f === t || (whole !== null && whole.test(f))));
}
