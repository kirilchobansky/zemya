/**
 * Server-only access to the built history timelines (public/data/history/<file>.json, one per
 * country listed in countries.ts).
 *
 * Route loaders run at build time (every page is prerendered), so this reads straight
 * from disk. The `.server` suffix guarantees React Router strips it from the client
 * bundle — mirrors app/lib/geography/catalog.server.ts. Converts each authored date
 * string to a decimal year (via app/lib/history/scale.ts's decimalYearOf, which is safe
 * to run here since it's plain portable logic) so the client receives ready-to-render
 * TimelineEntry objects, not raw YAML-shaped strings it would have to reparse.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decimalYearOf, KIND_RANK } from '~/lib/history/scale';
import type { TimelineEntry } from '~/lib/history/renderer';
import { HISTORY_COUNTRIES, historyCountryFor } from '~/lib/history/countries';
import { fillQuizzesFromRaw, type FillQuiz } from '~/lib/history/fill-quiz';

interface RawHistoryEntry {
  id: string;
  kind: TimelineEntry['kind'];
  name: { bg: string; en: string };
  aliases: string[];
  role: string | null;
  /** Absent means true; see content/history/bg.yaml's schema header. */
  elected?: boolean;
  start: string;
  end: string | null;
  precision: 'exact' | 'year' | 'circa' | 'disputed';
  style: 'old' | 'new';
  tier: number;
  parent: string | null;
  category: string | null;
  color: string | null;
  blurb: { bg: string; en: string };
  tags: string[];
}

interface RawHistoryDoc {
  version: number;
  entries: RawHistoryEntry[];
}

/** One row for the proofreading list view (routes/history.$slug.list.tsx) — the
 *  authored fields as-is, no decimal-year conversion (that's TimelineEntry's job, for the
 *  canvas only). */
export interface HistoryListRow {
  id: string;
  kind: RawHistoryEntry['kind'];
  role: string | null;
  name: string;
  start: string;
  end: string | null;
  tier: number;
  precision: RawHistoryEntry['precision'];
  category: string | null;
  parent: string | null;
}

const rawCache = new Map<string, RawHistoryEntry[]>();
const cache = new Map<string, TimelineEntry[]>();

function fileFor(slug: string): string {
  const country = historyCountryFor(slug);
  if (!country) throw new Error(`No history timeline for slug "${slug}" (see app/lib/history/countries.ts)`);
  return country.file;
}

function rawEntries(slug: string): RawHistoryEntry[] {
  let entries = rawCache.get(slug);
  if (!entries) {
    const path = join(process.cwd(), 'public', 'data', 'history', `${fileFor(slug)}.json`);
    entries = (JSON.parse(readFileSync(path, 'utf8')) as RawHistoryDoc).entries;
    rawCache.set(slug, entries);
  }
  return entries;
}

/** The text in the country's display language, the other language when that one is empty. */
const inLang = (t: { bg: string; en: string }, lang: 'bg' | 'en'): string =>
  t[lang] || t[lang === 'bg' ? 'en' : 'bg'];

function toTimelineEntry(raw: RawHistoryEntry, file: string, lang: 'bg' | 'en'): TimelineEntry {
  const where = `public/data/history/${file}.json: "${raw.id}"`;
  const start = decimalYearOf(raw.start, `${where}.start`);
  return {
    id: raw.id,
    kind: raw.kind,
    tier: raw.tier,
    parent: raw.parent,
    role: raw.role,
    start,
    // `end: null` means "ongoing" for a period/ruler/government (scale.ts's
    // visibleEntries treats it as extending to +Infinity, correctly — the Republic of
    // Bulgaria has no end date because it hasn't ended). An EVENT with no authored end is
    // a different thing: a single moment, not an open-ended span. Falling through to the
    // same +Infinity would make every undated-end event "ongoing" from its date forward,
    // so it would incorrectly still count as visible (and its pin would still draw) in
    // any later view's culling — caught by an actual render showing an 1185 event pin
    // while centred on 1247. Collapsing it to `start` here, once, is cheaper and more
    // obviously correct than teaching the generic, kind-agnostic scale.ts/layout.ts
    // pipeline a kind-specific exception.
    end: raw.end == null ? (raw.kind === 'event' ? start : null) : decimalYearOf(raw.end, `${where}.end`),
    // The country's own language (countries.ts `lang`); the canvas font stack
    // (app/lib/history/timeline.ts) covers Cyrillic and Latin.
    label: inLang(raw.name, lang),
    blurb: inLang(raw.blurb, lang),
    category: raw.category,
    color: raw.color,
    precision: raw.precision,
    tags: raw.tags,
    aliases: raw.aliases,
    style: raw.style
  };
}

export function timelineFor(slug: string): TimelineEntry[] {
  let entries = cache.get(slug);
  if (!entries) {
    const file = fileFor(slug);
    const lang = historyCountryFor(slug)!.lang;
    entries = rawEntries(slug).map(raw => toTimelineEntry(raw, file, lang));
    cache.set(slug, entries);
  }
  return entries;
}

/** Plain rows for the proofreading list view — sorted by start year (numeric, so "-450"
 *  sorts before "632"), then kind, in the fixed period/ruler/government/event order
 *  scale.ts's KIND_RANK already defines for the canvas, so the two views agree. */
export function historyListFor(slug: string): HistoryListRow[] {
  const lang = historyCountryFor(slug)!.lang;
  return rawEntries(slug)
    .map(raw => ({
      id: raw.id,
      kind: raw.kind,
      role: raw.role,
      name: inLang(raw.name, lang),
      start: raw.start,
      end: raw.end,
      tier: raw.tier,
      precision: raw.precision,
      category: raw.category,
      parent: raw.parent
    }))
    .sort((a, b) => parseInt(a.start, 10) - parseInt(b.start, 10) || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

/** Every "fill the list" quiz (app/lib/history/fill-quiz.ts) of every history country —
 *  one per row of fill-quiz-config.ts, its entries selected from the timeline by that row's
 *  filters. Build-time only, like the rest of this file. */
export function fillQuizzes(): FillQuiz[] {
  return HISTORY_COUNTRIES.flatMap(c => fillQuizzesFromRaw(rawEntries(c.slug), c.slug));
}
