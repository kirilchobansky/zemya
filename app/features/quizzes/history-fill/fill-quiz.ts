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
 * Arabic ones — so "Борис 1" = "Борис I". Forms of name (the country's display language) and its other-language twin:
 *   - a name carrying a number is accepted only WITH it: the whole name, or cut at the
 *     numeral ("Симеон I Велики" -> "Симеон 1"); the bare "Симеон" never is (`needsNumber`
 *     detects it, for the hint);
 *   - a name of two or more words also gives its surname (last word, numeral excluded). The
 *     first name alone is never a form;
 *   - a one-word name is its own form.
 * An alias is one exact accepted spelling, no derived forms. Whatever its source, a form
 * that belongs to two DIFFERENT people in the quiz (a shared surname, a shared alias) is
 * never accepted — the same name twice is the same person, and the earliest unfilled one
 * fills. Latin letters typed for a
 * Cyrillic name go through search.ts's Latin-to-Cyrillic compilation, matched against the
 * whole form. A single typo (one edit) is forgiven for names of 6+ letters — see `matchFill`
 * for the two conditions under which it is not.
 */
// Deep relative imports on purpose: react-router.config.ts loads this file at build time, and
// its config loader resolves neither the `~` alias nor a barrel full of components.
import { historyCountryFor } from '../../history/data/countries';
import { decimalYearOf } from '../../history/timeline/scale';
import { FILL_QUIZ_CONFIG, FULL_NAME_ONLY, NUMBER_OPTIONAL_ALIASES, type FillQuizConfig, type FillQuizToggle } from './fill-quiz-config';
import type { FillEntry, FillKind } from './fill-matching';

// the matching half lives in fill-matching.ts; everything stays importable from here
export * from './fill-matching';

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

/** A role as a title: parenthetical dropped ("цар (малолетен)" -> "цар"), spaces tidied. */
export function titleOf(role: string | null | undefined): string {
  return (role ?? '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

/** Titles that are never shown in a filled rectangle: the plain head-of-state office. */
const HIDDEN_TITLES: ReadonlySet<string> = new Set(['президент', 'president']);
export const isShownTitle = (title: string): boolean => title !== '' && !HIDDEN_TITLES.has(title);

/** True when the entries carry more than one distinct title (not counting "президент" / "president") — the
 *  only time titles are shown. */
export const hasMixedTitles = (entries: readonly Pick<FillEntry, 'title'>[]): boolean =>
  new Set(entries.map(e => e.title).filter(t => !HIDDEN_TITLES.has(t))).size > 1;

/** A name split for display: the main text and a trailing parenthesis, if any. */
export function splitNote(name: string): { main: string; note: string } {
  const m = /^(.*?)\s*(\([^)]*\))\s*$/.exec(name);
  return m && m[1] ? { main: m[1], note: m[2] } : { main: name, note: '' };
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
  const lang = historyCountryFor(slug)?.lang ?? 'bg';
  const other = lang === 'bg' ? 'en' : 'bg';
  for (const row of config) {
    const entries = raw
      .filter(r => r.kind === row.kind)
      .map(r => ({
        role: r.role ?? null,
        entry: {
          id: r.id,
          kind: row.kind,
          name: r.name[lang] || r.name[other],
          nameAlt: r.name[lang] ? r.name[other] : '',
          aliases: [...r.aliases, ...(NUMBER_OPTIONAL_ALIASES[r.id] ?? [])],
          fullNameOnly: FULL_NAME_ONLY.has(r.id),
          start: decimalYearOf(r.start, `${r.id}.start`),
          end: r.end == null ? null : decimalYearOf(r.end, `${r.id}.end`),
          startRaw: r.start,
          endRaw: r.end,
          elected: r.elected !== false,
          title: titleOf(r.role)
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
