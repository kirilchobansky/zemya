/**
 * Floating hover card for the history timeline (app/lib/history/timeline.ts's onHover) —
 * a DOM element positioned beside whatever entry the canvas has under the pointer, since
 * canvas itself can't render crisp, selectable, wrapping text. Mirrors the map's `.tip`
 * (routes/atlas.tsx) in spirit — floated over the canvas, pointer-events: none — but
 * carries real body copy, so it needs its own layout pass rather than a one-line label.
 *
 * Positioning is measured, not guessed: a layout effect reads the rendered card's own
 * height (its width is fixed, but a 3-line-clamped summary still varies in height with
 * font metrics) and flips left/up whenever the naive right/centred placement would run
 * off the canvas — see the effect below.
 *
 * Dates read straight off the entry's decimal-year `start`/`end` via scale.ts's
 * dateOfDecimalYear — the exact, `Date`-free inverse of the conversion catalog.server.ts
 * applied on the way in (see that module's own header on why `Date` is never used for an
 * authored date), so this never re-parses the authored YAML text itself.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

import { contextAt } from '~/lib/history/layout';
import type { TimelineEntry } from '~/lib/history/renderer';
import { dateOfDecimalYear } from '~/lib/history/scale';

const CARD_WIDTH = 280;
const GAP_PX = 10;
const EDGE_MARGIN_PX = 4;

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  war: 'War',
  treaty: 'Treaty',
  uprising: 'Uprising',
  church: 'Church',
  culture: 'Culture',
  politics: 'Politics',
  economy: 'Economy',
  disaster: 'Disaster',
  ruler: 'Ruler'
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function yearLabel(year: number): string {
  return year < 0 ? `${-year} BC` : String(year);
}

/** dd.mm.yyyy; year only when the month is unknown; "c. <year>" for circa precision —
 *  see the hover brief. */
function formatCardDate(t: number, precision: TimelineEntry['precision']): string {
  const d = dateOfDecimalYear(t);
  if (precision === 'circa') return `c. ${yearLabel(d.year)}`;
  if (d.month == null) return yearLabel(d.year);
  return `${pad2(d.day ?? 1)}.${pad2(d.month)}.${yearLabel(d.year)}`;
}

/** "1887 – 1918 · 31 years" — always plain years, regardless of the entry's own date
 *  precision (a range's duration reads oddly at day granularity). */
function formatRangeLine(startT: number, endT: number): string {
  const start = dateOfDecimalYear(startT).year;
  const end = dateOfDecimalYear(endT).year;
  const years = end - start;
  return `${yearLabel(start)} – ${yearLabel(end)} · ${years} year${years === 1 ? '' : 's'}`;
}

export interface HistoryCardProps {
  entry: TimelineEntry;
  /** The hovered region's rect, in the same canvas-relative CSS-pixel space the card
   *  itself is positioned in (see atlas.tsx). */
  rect: { x: number; y: number; w: number; h: number };
  /** The whole dataset — only events need it, to look up "Under: <ruler>, <period>" via
   *  contextAt at the event's own date. */
  entries: readonly TimelineEntry[];
  /** The canvas's own CSS size, for edge-flip clamping. */
  bounds: { width: number; height: number };
}

export default function HistoryCard({ entry, rect, entries, bounds }: HistoryCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: rect.x, top: rect.y, visibility: 'hidden' });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cardH = el.offsetHeight;

    let left = rect.x + rect.w + GAP_PX;
    if (left + CARD_WIDTH > bounds.width - EDGE_MARGIN_PX) left = rect.x - CARD_WIDTH - GAP_PX;
    left = Math.max(EDGE_MARGIN_PX, Math.min(left, bounds.width - CARD_WIDTH - EDGE_MARGIN_PX));

    let top = rect.y + rect.h / 2 - cardH / 2;
    if (top + cardH > bounds.height - EDGE_MARGIN_PX) top = rect.y - cardH - GAP_PX; // flip up
    top = Math.max(EDGE_MARGIN_PX, Math.min(top, bounds.height - cardH - EDGE_MARGIN_PX));

    setStyle({ left, top, visibility: 'visible' });
    // entry.id stands in for the whole entry (a hover never mutates its target in place).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, rect.x, rect.y, rect.w, rect.h, bounds.width, bounds.height]);

  return (
    <div ref={ref} className="history-card" style={style}>
      {entry.kind === 'event' && <EventBody entry={entry} entries={entries} />}
      {(entry.kind === 'ruler' || entry.kind === 'government') && <RulerBody entry={entry} />}
      {entry.kind === 'period' && <PeriodBody entry={entry} />}
    </div>
  );
}

function EventBody({ entry, entries }: { entry: TimelineEntry; entries: readonly TimelineEntry[] }) {
  const label = entry.category ? CATEGORY_LABELS[entry.category] ?? entry.category : null;
  const ctx = contextAt(entries, entry.start);
  const under = [ctx.ruler.primary?.label, ctx.period.primary?.label].filter(Boolean).join(', ');

  return (
    <>
      <div className="history-card__name">{entry.label}</div>
      <div className="history-card__date">{formatCardDate(entry.start, entry.precision)}</div>
      {label && (
        <div className="history-card__category">
          <span className="history-card__dot" style={{ background: entry.color ?? 'var(--ink-3)' }} />
          {label}
        </div>
      )}
      {entry.blurbBg && <p className="history-card__summary">{entry.blurbBg}</p>}
      {under && <div className="history-card__under">Under: {under}</div>}
    </>
  );
}

function RulerBody({ entry }: { entry: TimelineEntry }) {
  return (
    <>
      <div className="history-card__name">{entry.label}</div>
      {entry.role && <div className="history-card__role">{entry.role}</div>}
      <div className="history-card__date">{formatRangeLine(entry.start, entry.end ?? entry.start)}</div>
      {entry.blurbBg && <p className="history-card__summary">{entry.blurbBg}</p>}
    </>
  );
}

function PeriodBody({ entry }: { entry: TimelineEntry }) {
  return (
    <>
      <div className="history-card__name">{entry.label}</div>
      <div className="history-card__date">{formatRangeLine(entry.start, entry.end ?? entry.start)}</div>
      {entry.blurbBg && <p className="history-card__summary">{entry.blurbBg}</p>}
    </>
  );
}
