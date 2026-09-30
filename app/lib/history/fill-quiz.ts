/**
 * "Fill the list" — the first History quiz type. One quiz per row of fill-quiz-config.ts:
 * every ruler (or government) it selects is an empty rectangle showing only its years, and the player types names in any order. Pure logic only (no React, no DOM, no
 * Node) — HistoryFillQuiz.tsx draws it, catalog.server.ts feeds it at build time, and
 * react-router.config.ts derives the prerendered quiz URLs from it, so this file must stay
 * loadable outside the app's bundler (relative imports only).
 *
 * Matching (`matchFill`): a typed name is valid when, normalised, it equals one of an
 * entry's forms. Normalisation lower-cases, drops spaces/hyphens/dots and every non-letter,
 * strips the title words (хан, княз, цар, khan, prince, tsar) and turns Roman numerals into
 * Arabic ones — so "Борис 1" = "Борис I". An entry's forms are its Bulgarian name, English
 * name and aliases, each also without its numeral ("Борис") and cut at its numeral
 * ("Симеон I Велики" -> "Симеон 1", "Симеон"). Latin letters typed for a Cyrillic name go
 * through search.ts's Latin-to-Cyrillic compilation, matched against the whole form.
 * A single typo (one edit) is forgiven for names of 6+ letters — see `matchFill` for the
 * two conditions under which it is not.
 */
import { latinToCyrillicRegExp } from './search';
import { decimalYearOf } from './scale';
import { FILL_QUIZ_CONFIG, type FillQuizConfig, type FillQuizToggle } from './fill-quiz-config';

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

/** Every form of one name that a player may type, normalised. */
function formsOf(name: string): string[] {
  const toks = tokens(name);
  const forms = new Set<string>([toks.join('')]);
  const at = toks.findIndex((t, i) => i > 0 && isNumeralToken(t));
  if (at > 0) {
    forms.add(toks.filter((_, i) => i !== at).join('')); // Борис
    forms.add(toks.slice(0, at + 1).join('')); // Симеон 1 (of Симеон I Велики)
    forms.add(toks.slice(0, at).join('')); // Симеон
  }
  forms.delete('');
  return [...forms];
}

// ---------------------------------------------------------------------------- matching

export interface FillEntry {
  id: string;
  kind: FillKind;
  nameBg: string;
  nameEn: string;
  aliases: readonly string[];
  /** Decimal years (scale.ts). `end` is null for an entry that is still ongoing. */
  start: number;
  end: number | null;
  /** The authored date strings, for the dd.mm.yyyy tooltip. */
  startRaw: string;
  endRaw: string | null;
  /** False when the office was not filled by a public vote (bg.yaml `elected`). */
  elected: boolean;
}

export interface PreparedFillEntry {
  id: string;
  forms: readonly string[];
}

/** Compile each entry's typeable forms once, not per keystroke. Keep the entries in
 *  chronological order: "earliest unfilled" means lowest index. */
export function prepareFill(entries: readonly FillEntry[]): PreparedFillEntry[] {
  return entries.map(e => ({
    id: e.id,
    forms: [...new Set([e.nameBg, e.nameEn, ...e.aliases].filter(Boolean).flatMap(formsOf))]
  }));
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

// ---------------------------------------------------------------------------- display

/** "681–700", or just "681" when the span is within one year; an open end reads "1989–". */
export function yearLabel(entry: Pick<FillEntry, 'start' | 'end'>): string {
  const from = Math.floor(entry.start);
  if (entry.end === null) return `${from}–`;
  if (entry.end - entry.start <= 1) return String(from);
  return `${from}–${Math.floor(entry.end)}`;
}

/** An authored date ("1879-07-05", "1879-07", "1879") as dd.mm.yyyy, with only the parts
 *  that were authored — a year-only date stays a bare year rather than inventing 01.01. */
export function formatFillDate(raw: string): string {
  const [year, month, day] = raw.split('-');
  return [day, month, year].filter(Boolean).join('.');
}

/** "05.07.1879 – 26.11.1879", or "1989 – today" for an open end. */
export function dateRangeLabel(entry: Pick<FillEntry, 'startRaw' | 'endRaw'>): string {
  return `${formatFillDate(entry.startRaw)} – ${entry.endRaw ? formatFillDate(entry.endRaw) : 'today'}`;
}

// ---------------------------------------------------------------------------- quiz list

export interface FillQuiz {
  /** URL segment: /quizzes/history/<id>. Also the key personal bests are stored under. */
  id: string;
  slug: string;
  kind: FillKind;
  /** "Rulers of the First Bulgarian Empire" */
  title: string;
  /** Chronological: by start, then end. Everything the row selects, toggle off. */
  entries: FillEntry[];
  /** Set when the row has a toggle; the entries it drops are those with `elected: false`. */
  toggle: FillQuizToggle | null;
}

/** The authored shape of a public/data/history/<file>.json entry — only what quizzes read. */
export interface FillRawEntry {
  id: string;
  kind: string;
  name: { bg: string; en: string };
  aliases: readonly string[];
  role?: string | null;
  elected?: boolean;
  start: string;
  end: string | null;
}

/** The entries a run plays: all of them, or with the toggle on only the elected ones. */
export function entriesFor(quiz: Pick<FillQuiz, 'entries' | 'toggle'>, toggleOn: boolean): FillEntry[] {
  return quiz.toggle && toggleOn ? quiz.entries.filter(e => e.elected) : quiz.entries;
}

/** Does `entry` belong to the row? Kind, role regex and the start window (from inclusive,
 *  before exclusive). The toggle is not applied here — see `entriesFor`. */
export function selectedBy(config: FillQuizConfig, entry: FillEntry, role: string | null): boolean {
  if (entry.kind !== config.kind || !config.role.test(role ?? '')) return false;
  if (config.from !== undefined && entry.start < decimalYearOf(config.from, `${config.id}.from`)) return false;
  if (config.before !== undefined && entry.start >= decimalYearOf(config.before, `${config.id}.before`)) return false;
  return true;
}

/**
 * Every quiz a country's timeline yields, one per config row and in the config's order
 * (`config` defaults to the country's own table, fill-quiz-config.ts). Nothing is sampled:
 * every entry a row selects is included. A row selecting nothing is dropped.
 */
export function fillQuizzesFromRaw(
  raw: readonly FillRawEntry[],
  slug: string,
  config: readonly FillQuizConfig[] = FILL_QUIZ_CONFIG[slug] ?? []
): FillQuiz[] {
  const quizzes: FillQuiz[] = [];
  for (const row of config) {
    const entries = raw
      .filter(r => r.kind === row.kind)
      .map(r => ({
        role: r.role ?? null,
        entry: {
          id: r.id,
          kind: row.kind,
          nameBg: r.name.bg,
          nameEn: r.name.en,
          aliases: r.aliases,
          start: decimalYearOf(r.start, `${r.id}.start`),
          end: r.end == null ? null : decimalYearOf(r.end, `${r.id}.end`),
          startRaw: r.start,
          endRaw: r.end,
          elected: r.elected !== false
        } satisfies FillEntry
      }))
      .filter(({ entry, role }) => selectedBy(row, entry, role))
      .map(({ entry }) => entry)
      .sort((a, b) => a.start - b.start || (a.end ?? Infinity) - (b.end ?? Infinity));
    if (!entries.length) continue;
    quizzes.push({ id: row.id, slug, kind: row.kind, title: row.title, entries, toggle: row.toggle ?? null });
  }
  return quizzes;
}
