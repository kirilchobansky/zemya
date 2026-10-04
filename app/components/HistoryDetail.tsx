/**
 * The full detail view for a history timeline entry (routes/history.$slug.tsx, shown
 * whenever a pinned card's "See more" — or a row inside this same view — has set
 * `selectedHistoryEntryId`). Replaces the plain detail block that shipped first; unlike
 * that block, this one shows context (what else was true at the same moment), related
 * entries and lets the reader step to chronological neighbours without leaving the panel.
 *
 * Every row that names another entry (context, neighbours, related, stepping) both opens
 * that entry's own detail (`onOpen`) and flies the canvas to it — "clicking anything here
 * behaves like clicking it on the timeline itself."
 */
import { useMemo, useState } from 'react';

import { CATEGORY_LABELS, formatCardDate } from './HistoryCard';
import { entriesInSpan, neighbours, relatedByTags } from '~/lib/history/related';
import { contextAt } from '~/lib/history/layout';
import type { TimelineEntry } from '~/lib/history/renderer';
import { formatDuration } from '~/lib/history/scale';
import { flyTargetFor, type HistoryTimeline } from '~/lib/history/timeline';

const KIND_LABELS: Readonly<Record<TimelineEntry['kind'], string>> = {
  event: 'Event',
  ruler: 'Ruler',
  government: 'Government',
  period: 'Period'
};

const RELATED_LIMIT = 6;
const CONTEXT_LIST_LIMIT = 10;

/** Full range at the entry's own date precision (dd.mm.yyyy where known, else just the
 *  year, "c." for circa — see formatCardDate), plus a plain-years duration for a real span.
 *  A single-moment entry (event, or a span collapsed to one instant) shows just its date. */
function formatDetailDates(entry: TimelineEntry): string {
  const end = entry.end ?? entry.start;
  if (end === entry.start) return formatCardDate(entry.start, entry.precision);
  return `${formatCardDate(entry.start, entry.precision)} – ${formatCardDate(end, entry.precision)} · ${formatDuration(entry.start, end)}`;
}

/** The previous/next entry of the SAME KIND ONLY (role-agnostic, unlike related.ts's
 *  neighbours(), which the context section uses for "Previous"/"Next" within a role) —
 *  what the top-of-view stepping buttons step through, so a reader can walk period → period
 *  or event → event across the whole timeline regardless of role. */
function chronologicalStep(entry: TimelineEntry, entries: readonly TimelineEntry[]): { previous: TimelineEntry | null; next: TimelineEntry | null } {
  const siblings = entries
    .filter(e => e.kind === entry.kind && e.id !== entry.id)
    .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let previous: TimelineEntry | null = null;
  let next: TimelineEntry | null = null;
  for (const s of siblings) {
    if (s.start < entry.start && (!previous || s.start > previous.start)) previous = s;
    if (s.start > entry.start && (!next || s.start < next.start)) next = s;
  }
  return { previous, next };
}

export interface HistoryDetailProps {
  entry: TimelineEntry;
  entries: readonly TimelineEntry[];
  /** Null only for the brief window before the canvas controller mounts (same convention
   *  as HistoryOutline) — every fly-to below no-ops until it's set. */
  timeline: HistoryTimeline | null;
  /** Opens another entry's own detail view in place of this one — every row here that
   *  names an entry uses this, never a raw setState the caller would have to re-derive. */
  onOpen: (id: string) => void;
  onBack: () => void;
  /** Pins `entry` as a floating card (same mechanism as clicking it on the canvas) — routes/
   *  history.$slug.tsx wires this to the atlas context's pin-by-id helper, since this
   *  view has no canvas rect of its own to seed the card's position from. */
  onPin: (entry: TimelineEntry) => void;
}

export default function HistoryDetail({ entry, entries, timeline, onOpen, onBack, onPin }: HistoryDetailProps) {
  const step = useMemo(() => chronologicalStep(entry, entries), [entry, entries]);
  const categoryLabel = entry.category ? CATEGORY_LABELS[entry.category] ?? entry.category : null;

  function goTo(target: TimelineEntry) {
    onOpen(target.id);
    if (timeline) {
      const { centre, pxPerYear } = flyTargetFor(target, timeline.viewportSizePx);
      timeline.flyTo(centre, pxPerYear, target.id);
    }
  }

  return (
    <div className="history-detail">
      <div className="history-detail__steps">
        <button type="button" className="action" disabled={!step.previous} onClick={() => step.previous && goTo(step.previous)}>
          ← Previous
        </button>
        <button type="button" className="action" disabled={!step.next} onClick={() => step.next && goTo(step.next)}>
          Next →
        </button>
      </div>

      <div className="history-detail__header">
        <span className="history-detail__kind">{KIND_LABELS[entry.kind]}</span>
        {categoryLabel && (
          <span className="history-detail__category">
            <span className="history-card__dot" style={{ background: entry.color ?? 'var(--ink-3)' }} />
            {categoryLabel}
          </span>
        )}
        <button type="button" className="action history-detail__back" onClick={onBack}>
          Back
        </button>
      </div>

      <h3 className="history-detail__name">{entry.label}</h3>
      {entry.role && <div className="history-detail__role">{entry.role}</div>}

      <div className="history-detail__dates">{formatDetailDates(entry)}</div>
      {entry.style === 'old' && <div className="history-detail__style-note">Old style (Julian calendar)</div>}

      {entry.blurb && <p className="history-detail__summary">{entry.blurb}</p>}
      {entry.tags.length > 0 && (
        <div className="chips">
          {entry.tags.map(tag => (
            <span key={tag} className="chip">{tag}</span>
          ))}
        </div>
      )}

      <div className="history-detail__actions">
        <button type="button" className="action" onClick={() => goTo(entry)}>
          Show on timeline
        </button>
        <button type="button" className="action" onClick={() => onPin(entry)}>
          Pin card
        </button>
      </div>

      {entry.kind === 'event' && <EventContext entry={entry} entries={entries} onSelect={goTo} />}
      {(entry.kind === 'ruler' || entry.kind === 'government') && <ReignContext entry={entry} entries={entries} onSelect={goTo} />}
      {entry.kind === 'period' && <PeriodContext entry={entry} entries={entries} onSelect={goTo} />}

      <Related entry={entry} entries={entries} onSelect={goTo} />
    </div>
  );
}

function EntryRow({ entry, onSelect }: { entry: TimelineEntry; onSelect: (e: TimelineEntry) => void }) {
  return (
    <li>
      <button type="button" className="history-detail__row" onClick={() => onSelect(entry)}>
        <span className="history-detail__row-date">{formatCardDate(entry.start, entry.precision)}</span>
        <span className="history-detail__row-name">{entry.label}</span>
      </button>
    </li>
  );
}

function EntrySection({
  title, rows, limit, onSelect
}: { title: string; rows: TimelineEntry[]; limit: number; onSelect: (e: TimelineEntry) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, limit);
  return (
    <div className="history-detail__section">
      <h4 className="history-detail__section-title">{title}</h4>
      <ul className="history-detail__rows">
        {shown.map(row => (
          <EntryRow key={row.id} entry={row} onSelect={onSelect} />
        ))}
      </ul>
      {!expanded && rows.length > limit && (
        <button type="button" className="history-detail__show-all" onClick={() => setExpanded(true)}>
          Show all ({rows.length})
        </button>
      )}
    </div>
  );
}

function EventContext({ entry, entries, onSelect }: { entry: TimelineEntry; entries: readonly TimelineEntry[]; onSelect: (e: TimelineEntry) => void }) {
  const ctx = useMemo(() => contextAt(entries, entry.start), [entries, entry.start]);
  const rows = [ctx.period.primary, ...ctx.ruler.all, ctx.government.primary].filter((e): e is TimelineEntry => e != null);
  if (rows.length === 0) return null;
  return (
    <div className="history-detail__section">
      <h4 className="history-detail__section-title">When this happened</h4>
      <ul className="history-detail__rows">
        {rows.map(row => (
          <EntryRow key={row.id} entry={row} onSelect={onSelect} />
        ))}
      </ul>
    </div>
  );
}

function ReignContext({ entry, entries, onSelect }: { entry: TimelineEntry; entries: readonly TimelineEntry[]; onSelect: (e: TimelineEntry) => void }) {
  const { previous, next } = useMemo(() => neighbours(entry, entries), [entry, entries]);
  const duringReign = useMemo(
    () => entriesInSpan(entries, entry.start, entry.end ?? Infinity, 2).filter(e => e.kind === 'event'),
    [entries, entry.start, entry.end]
  );
  return (
    <>
      {(previous || next) && (
        <div className="history-detail__section">
          <h4 className="history-detail__section-title">Neighbours</h4>
          <ul className="history-detail__rows">
            {previous && <EntryRow entry={previous} onSelect={onSelect} />}
            {next && <EntryRow entry={next} onSelect={onSelect} />}
          </ul>
        </div>
      )}
      <EntrySection title="During this reign" rows={duringReign} limit={CONTEXT_LIST_LIMIT} onSelect={onSelect} />
    </>
  );
}

function PeriodContext({ entry, entries, onSelect }: { entry: TimelineEntry; entries: readonly TimelineEntry[]; onSelect: (e: TimelineEntry) => void }) {
  const rulers = useMemo(
    () => entriesInSpan(entries, entry.start, entry.end ?? Infinity, Infinity).filter(e => e.kind === 'ruler'),
    [entries, entry.start, entry.end]
  );
  const keyEvents = useMemo(
    () => entriesInSpan(entries, entry.start, entry.end ?? Infinity, 1).filter(e => e.kind === 'event'),
    [entries, entry.start, entry.end]
  );
  return (
    <>
      <EntrySection title="Rulers" rows={rulers} limit={CONTEXT_LIST_LIMIT} onSelect={onSelect} />
      <EntrySection title="Key events" rows={keyEvents} limit={CONTEXT_LIST_LIMIT} onSelect={onSelect} />
    </>
  );
}

function Related({ entry, entries, onSelect }: { entry: TimelineEntry; entries: readonly TimelineEntry[]; onSelect: (e: TimelineEntry) => void }) {
  const related = useMemo(() => relatedByTags(entry, entries, RELATED_LIMIT), [entry, entries]);
  if (related.length === 0) return null;
  return (
    <div className="history-detail__section">
      <h4 className="history-detail__section-title">Related</h4>
      <ul className="history-detail__rows">
        {related.map(row => (
          <EntryRow key={row.id} entry={row} onSelect={onSelect} />
        ))}
      </ul>
    </div>
  );
}
