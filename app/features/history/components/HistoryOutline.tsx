/**
 * The history panel's outline list (routes/history.$slug.tsx, shown whenever
 * no pinned card's "See more" has swapped the panel to a detail view) — a vertical list of
 * periods, one section each, in date order. Only one section is expanded at a time; the
 * section containing the timeline's own centre date ("you are here") auto-expands as the
 * user pans, unless they've manually expanded a different one (an auto-expand-until-
 * override, cleared the moment the centre date moves into a DIFFERENT period — see
 * `overrideRef` below).
 *
 * Nesting (Възраждане under Османско владичество) isn't authored in content/history/bg.yaml
 * (no `parent` id on either) — it falls out of the same date-containment + tier rule
 * app/lib/history/layout.ts's `contextAt` already uses to pick a primary among overlapping
 * periods: a period fully contained by another with a lower (more important) tier nests
 * under it. That also means `currentPeriodId` (timeline.ts's contextAt-driven
 * onPeriodChange) can never itself BE a nested period's id while the ranges overlap — the
 * container always wins as `primary` — so only top-level sections ever auto-expand as
 * "here"; a nested one is reachable only by clicking it.
 *
 * All sections start closed, and "you are here" is a marker only (it never auto-opens a
 * section on its own) — reading the panel on open must not surprise the visitor with an
 * already-expanded section they didn't ask for. "Follow timeline", off by default, opts
 * back into the old auto-expand-as-you-pan behaviour; flipping it on immediately opens
 * whichever section is "here" right now, same as panning into a new one would once it's on.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { formatCardDate } from './HistoryCard';
import { flyTargetFor, type HistoryTimeline } from '~/lib/history/timeline';
import { dateOfDecimalYear } from '~/lib/history/scale';
import type { TimelineEntry } from '~/lib/history/renderer';

export interface HistoryOutlineProps {
  entries: readonly TimelineEntry[];
  /** timeline.ts's contextAt-driven "you are here" period id, or null in a gap — throttled
   *  to at most 5 updates/second upstream (see HistoryTimeline's onPeriodChange). */
  currentPeriodId: string | null;
  /** Null only for the brief window before the canvas controller mounts — every handler
   *  below no-ops until it's set. */
  timeline: HistoryTimeline | null;
}

interface Section {
  period: TimelineEntry;
  depth: number;
}

function yearLabel(year: number): string {
  return year < 0 ? `${-year} BC` : String(year);
}

/** "1185 – 1396", or "1989 – today" for an ongoing period (`end: null` — matches the
 *  header's own "681 – today" wording, routes/history.$slug.tsx). */
function rangeLabel(period: TimelineEntry): string {
  const start = yearLabel(dateOfDecimalYear(period.start).year);
  if (period.end == null) return `${start} – today`;
  return `${start} – ${yearLabel(dateOfDecimalYear(period.end).year)}`;
}

/** The tightest OTHER period that fully contains `period` and outranks it (a lower tier
 *  number) — see the module header on why this stands in for an authored `parent`. */
function containingPeriod(period: TimelineEntry, periods: readonly TimelineEntry[]): TimelineEntry | null {
  const candidates = periods.filter(
    q =>
      q.id !== period.id &&
      q.tier < period.tier &&
      q.start <= period.start &&
      (q.end ?? Infinity) >= (period.end ?? Infinity)
  );
  if (!candidates.length) return null;
  return candidates.reduce((best, q) => (q.tier > best.tier ? q : best));
}

/** Periods in outline order: top-level periods by start date, each immediately followed by
 *  its own nested children (also by start date) at one greater depth — a simple tree flatten,
 *  since today's data only ever nests one level deep, but recursive so a future second level
 *  costs nothing here. */
function buildSections(periods: readonly TimelineEntry[]): Section[] {
  const parentOf = new Map(periods.map(p => [p.id, containingPeriod(p, periods)] as const));
  const childrenOf = new Map<string, TimelineEntry[]>();
  for (const p of periods) {
    const parent = parentOf.get(p.id);
    if (!parent) continue;
    (childrenOf.get(parent.id) ?? childrenOf.set(parent.id, []).get(parent.id)!).push(p);
  }
  for (const kids of childrenOf.values()) kids.sort((a, b) => a.start - b.start);

  const out: Section[] = [];
  const walk = (p: TimelineEntry, depth: number) => {
    out.push({ period: p, depth });
    for (const child of childrenOf.get(p.id) ?? []) walk(child, depth + 1);
  };
  const topLevel = periods.filter(p => !parentOf.get(p.id)).sort((a, b) => a.start - b.start);
  for (const p of topLevel) walk(p, 0);
  return out;
}

/** A period's own tier-1 events and tier-1 rulers, sorted by date — the expanded section's
 *  row list. Overlap, not strict containment (a ruler's reign can straddle a period edge). */
function rowsFor(period: TimelineEntry, entries: readonly TimelineEntry[]): TimelineEntry[] {
  const periodEnd = period.end ?? Infinity;
  return entries
    .filter(e => (e.kind === 'event' || e.kind === 'ruler') && e.tier === 1)
    .filter(e => (e.end ?? e.start) >= period.start && e.start <= periodEnd)
    .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
}

function SectionRows({
  period, entries, onSelect
}: { period: TimelineEntry; entries: readonly TimelineEntry[]; onSelect: (e: TimelineEntry) => void }) {
  const rows = useMemo(() => rowsFor(period, entries), [period, entries]);
  return (
    <ul className="history-outline__rows">
      {rows.map(row => (
        <li key={row.id}>
          <button type="button" className="history-outline__row" onClick={() => onSelect(row)}>
            <span className="history-outline__row-date">{formatCardDate(row.start, row.precision)}</span>
            <span className="history-outline__row-name">{row.label}</span>
            {row.kind === 'ruler' && row.role && <span className="history-outline__row-role">{row.role}</span>}
          </button>
        </li>
      ))}
      {rows.length === 0 && <li className="history-outline__empty">Nothing tier-1 here yet.</li>}
    </ul>
  );
}

export default function HistoryOutline({ entries, currentPeriodId, timeline }: HistoryOutlineProps) {
  const periods = useMemo(
    () => entries.filter(e => e.kind === 'period').sort((a, b) => a.start - b.start),
    [entries]
  );
  const sections = useMemo(() => buildSections(periods), [periods]);

  // Every section starts closed — "here" is a marker only (rendered from currentPeriodId
  // directly below), never an auto-open, until the reader opts into "Follow timeline".
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [followTimeline, setFollowTimeline] = useState(false);
  /** True once the reader has clicked a section directly while following — auto-expand
   *  stops moving it until `currentPeriodId` itself changes to a DIFFERENT period (the
   *  effect below). */
  const overrideRef = useRef(false);
  const lastAutoIdRef = useRef(currentPeriodId);

  // Turning "Follow timeline" on always opens "here" immediately, same as panning into a
  // new period would once it's on — reset any earlier override first so that isn't
  // suppressed by a click from a previous stretch of following.
  useEffect(() => {
    if (followTimeline) overrideRef.current = false;
  }, [followTimeline]);

  useEffect(() => {
    if (!followTimeline) return;
    if (currentPeriodId !== lastAutoIdRef.current) {
      lastAutoIdRef.current = currentPeriodId;
      overrideRef.current = false;
    }
    if (!overrideRef.current) setExpandedId(currentPeriodId);
  }, [currentPeriodId, followTimeline]);

  function flyToEntry(entry: TimelineEntry) {
    if (!timeline) return;
    const { centre, pxPerYear } = flyTargetFor(entry, timeline.viewportSizePx);
    timeline.flyTo(centre, pxPerYear, entry.id);
  }

  function handlePeriodClick(period: TimelineEntry) {
    overrideRef.current = true;
    setExpandedId(id => (id === period.id ? null : period.id));
    flyToEntry(period);
  }

  return (
    <div className="history-outline">
      <label className="history-outline__follow">
        <input
          type="checkbox"
          checked={followTimeline}
          onChange={e => setFollowTimeline(e.target.checked)}
        />
        Follow timeline
      </label>

      {sections.map(({ period, depth }) => (
        <div key={period.id} className="history-outline__section">
          <button
            type="button"
            className={`history-outline__period${depth ? ' history-outline__period--nested' : ''}${
              period.id === currentPeriodId ? ' is-here' : ''
            }`}
            onClick={() => handlePeriodClick(period)}
            aria-expanded={period.id === expandedId}
          >
            <span className="history-outline__swatch" style={{ background: period.color ?? 'var(--ink-3)' }} />
            <span className="history-outline__text">
              <span className="history-outline__name">
                {period.label}
                {period.id === currentPeriodId && <span className="history-outline__here">You are here</span>}
              </span>
              <span className="history-outline__range">{rangeLabel(period)}</span>
            </span>
          </button>

          {period.id === expandedId && <SectionRows period={period} entries={entries} onSelect={flyToEntry} />}
        </div>
      ))}
    </div>
  );
}
