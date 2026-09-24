/**
 * Layout logic for the history timeline, built on app/lib/history/scale.ts's time axis.
 * Pure logic (no canvas, no React, no DOM) — same discipline as scale.ts itself.
 *
 * Everything here takes already-converted decimal-year entries (scale.ts's
 * decimalYearOfDate turns an authored date into one) and a Viewport; nothing in this file
 * knows about YAML, JSON or the parser.
 */
import {
  type EntryKind, type HistoryEntry, type Viewport, levelFor, maxTierFor, pxToTime, timeToPx, visibleRange
} from './scale';

export interface LayoutEntry extends HistoryEntry {
  /** Explicit override for containment/primacy ambiguity — see contextAt below. Points at
   *  another entry's id, normally a co-containing sibling of the same kind. */
  parent: string | null;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

/** Deterministic tie-break used everywhere in this file: lower tier wins, then id order —
 *  never input order, so results don't depend on how the caller happened to list entries. */
function compareByTierThenId(a: LayoutEntry, b: LayoutEntry): number {
  return a.tier - b.tier || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function endOf(e: HistoryEntry): number {
  return e.end ?? Infinity;
}

function contains(e: LayoutEntry, t: number): boolean {
  return e.start <= t && t <= endOf(e);
}

/* ------------------------------------------------------------------------- context stack */

const CONTEXT_KINDS: readonly EntryKind[] = ['period', 'ruler', 'government'];

export interface ContextSlot {
  /** The one entry to show as "the" context, or null if nothing of this kind contains t —
   *  a gap, which is normal (e.g. between the Second Empire's fall and the Ottoman
   *  period's own start-of-rulers gap). Always a member of `all` when non-null. */
  primary: LayoutEntry | null;
  /** Every entry of this kind containing t, including `primary`. Length 0 in a gap, 1 in
   *  the normal case (one head of state on the `ruler` wire, one cabinet on the
   *  `government` wire — heads of state stay on `ruler` across every era, хан through
   *  президент; `government` is cabinets only, and only exists from 1878 on), 2+ only for
   *  genuine containment ambiguity (true co-rulers, or an overlapping period). */
  all: LayoutEntry[];
}

export interface Context {
  period: ContextSlot;
  ruler: ContextSlot;
  government: ContextSlot;
}

/**
 * Picks the primary among several entries of the same kind that all contain the same
 * moment. If one of them names another as `parent`, that other one wins (an explicit
 * override of the default rule). Otherwise the better (lower) tier wins; ties break on id
 * so the result never depends on array order.
 */
function primaryOf(candidates: readonly LayoutEntry[]): LayoutEntry | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const ids = new Set(candidates.map(c => c.id));
  const subordinate = candidates.find(c => c.parent && ids.has(c.parent));
  if (subordinate) return candidates.find(c => c.id === subordinate.parent) ?? null;
  return [...candidates].sort(compareByTierThenId)[0];
}

/** What contains the moment `t`: the period, ruler and government (if any) whose
 *  [start, end] span covers it. Pure date containment, except that an entry's explicit
 *  `parent` overrides which of several co-containing entries of the same kind is
 *  `primary` (see primaryOf). */
export function contextAt(entries: readonly LayoutEntry[], t: number): Context {
  const slot = (kind: EntryKind): ContextSlot => {
    const all = entries.filter(e => e.kind === kind && contains(e, t));
    return { primary: primaryOf(all), all };
  };
  const [period, ruler, government] = CONTEXT_KINDS.map(slot);
  return { period, ruler, government };
}

/* --------------------------------------------------------------------- bar vs pinned label */

export type Span =
  | { mode: 'bar'; fromPx: number; toPx: number }
  | { mode: 'pinned'; labelPx: number };

/**
 * Whether `entry` draws as a normal bar or, when it is wider than the viewport, as a
 * label pinned inside the visible area instead (so a period spanning centuries still has
 * a readable label while you're zoomed into a handful of years inside it). An ongoing
 * entry (`end: null`) is treated as running at least to the viewport's right edge, so it
 * classifies exactly like a bounded one whose end happens to sit at that edge.
 */
export function classifySpan(entry: LayoutEntry, viewport: Viewport): Span {
  const endT = entry.end ?? pxToTime(viewport.sizePx, viewport);
  const rawFromPx = timeToPx(entry.start, viewport);
  const rawToPx = timeToPx(endT, viewport);

  if (rawToPx - rawFromPx <= viewport.sizePx) {
    return {
      mode: 'bar',
      fromPx: clamp(rawFromPx, 0, viewport.sizePx),
      toPx: clamp(rawToPx, 0, viewport.sizePx)
    };
  }
  return { mode: 'pinned', labelPx: clamp(rawFromPx, 0, viewport.sizePx) };
}

/* ------------------------------------------------------------------------------------ rows */

/**
 * Packs entries of the same kind into 0-based sub-rows so overlapping spans (co-rulers,
 * or simply period+Възраждане-style overlapping periods) never collide. Computed from the
 * WHOLE dataset, not the visible subset, and only from dates — so an entry's row never
 * changes as the viewport pans or zooms, which is the point: a row flip mid-pan would be
 * visually jarring. Deterministic: sorts by start (ties by id) before the greedy pack, so
 * the same input always yields the same row for the same entry.
 */
export function assignRows(entries: readonly LayoutEntry[]): Map<string, number> {
  const rows = new Map<string, number>();
  const byKind = new Map<EntryKind, LayoutEntry[]>();
  for (const e of entries) {
    (byKind.get(e.kind) ?? byKind.set(e.kind, []).get(e.kind)!).push(e);
  }

  for (const group of byKind.values()) {
    const sorted = [...group].sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const rowEnds: number[] = []; // last occupied end-time per row index
    for (const e of sorted) {
      let row = rowEnds.findIndex(end => e.start >= end);
      if (row === -1) { row = rowEnds.length; rowEnds.push(-Infinity); }
      rowEnds[row] = endOf(e);
      rows.set(e.id, row);
    }
  }
  return rows;
}

/* --------------------------------------------------------------------------------- density */

/**
 * `bucketCount` values in 0..1 across the viewport's visible range, one per equal-width
 * time bucket — how much is hidden there at the CURRENT zoom, for the "there is more
 * here, zoom in" glow. Counts only entries whose tier is below what maxTierFor allows at
 * this level (or whose kind is invisible here entirely); an entry already drawn doesn't
 * add to its own bucket's density. Normalised by the busiest bucket, so the result is
 * relative to what's on screen right now, not to some fixed absolute count.
 */
export function densityBuckets(entries: readonly LayoutEntry[], viewport: Viewport, bucketCount: number): number[] {
  if (bucketCount <= 0) return [];
  const counts = new Array<number>(bucketCount).fill(0);

  const level = levelFor(viewport.pxPerYear);
  const { from, to } = visibleRange(viewport);
  const span = to - from;
  if (span <= 0) return counts;

  for (const e of entries) {
    const max = maxTierFor(level, e.kind);
    if (max > 0 && e.tier <= max) continue; // already visible at this zoom — not "hidden"

    const endT = endOf(e);
    if (endT < from || e.start > to) continue; // no overlap with what's on screen

    const startFrac = (clamp(e.start, from, to) - from) / span;
    const endFrac = (clamp(endT, from, to) - from) / span;
    const lo = clamp(Math.floor(startFrac * bucketCount), 0, bucketCount - 1);
    const hi = clamp(Math.floor(endFrac * bucketCount), 0, bucketCount - 1);
    for (let b = lo; b <= hi; b++) counts[b] += 1;
  }

  const busiest = Math.max(...counts);
  return busiest === 0 ? counts : counts.map(c => c / busiest);
}

/* --------------------------------------------------------------------------- label collision */

export interface LabelCandidate {
  px: number;
  widthPx: number;
  tier: number;
  id: string;
}

function overlaps(a: LabelCandidate, b: LabelCandidate): boolean {
  return a.px < b.px + b.widthPx && b.px < a.px + a.widthPx;
}

/**
 * Greedily keeps the best-tier label at each screen position, dropping any candidate that
 * overlaps one already kept. Processes candidates best-tier-first (lower tier number =
 * more important), ties broken by id, so — like everywhere else in this file — the result
 * depends only on the candidates themselves, never on the order they were passed in.
 * Returns the survivors left-to-right by position.
 */
export function placeLabels(candidates: readonly LabelCandidate[]): LabelCandidate[] {
  const ordered = [...candidates].sort(
    (a, b) => a.tier - b.tier || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  const kept: LabelCandidate[] = [];
  for (const c of ordered) {
    if (!kept.some(k => overlaps(k, c))) kept.push(c);
  }
  return kept.sort((a, b) => a.px - b.px || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
