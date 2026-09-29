/**
 * Floating cards for the history timeline: the hover card (app/lib/history/timeline.ts's
 * onHover) and the pinned card it clicks into (onEntryClick) — both DOM elements
 * positioned beside whatever entry the canvas has under the pointer, since canvas itself
 * can't render crisp, selectable, wrapping text. The hover card mirrors the map's `.tip`
 * (routes/atlas.tsx) in spirit — floated over the canvas, pointer-events: none, no
 * animation; the pinned card is the same shell (HistoryCardBody) made interactive:
 * pointer-events: auto, a close button, draggable, stays until closed.
 *
 * Positioning is measured, not guessed: a layout effect reads the rendered card's own
 * height (its width is fixed, but a 3-line-clamped summary still varies in height with
 * font metrics) and flips left/up whenever the naive right/centred placement would run
 * off the canvas — see the effects below. A pinned card only runs this once, on mount;
 * afterwards its position is drag state the card owns itself, not re-derived from its rect.
 *
 * Dates read straight off the entry's decimal-year `start`/`end` via scale.ts's
 * dateOfDecimalYear — the exact, `Date`-free inverse of the conversion catalog.server.ts
 * applied on the way in (see that module's own header on why `Date` is never used for an
 * authored date), so this never re-parses the authored YAML text itself.
 */
import {
  useLayoutEffect, useRef, useState,
  type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent
} from 'react';

import { contextAt } from '~/lib/history/layout';
import type { TimelineEntry } from '~/lib/history/renderer';
import { dateOfDecimalYear, formatDuration } from '~/lib/history/scale';
import { flyTargetFor, type HistoryTimeline } from '~/lib/history/timeline';

const CARD_WIDTH = 280;
const GAP_PX = 10;
const EDGE_MARGIN_PX = 4;

export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
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
 *  see the hover brief. Exported for the pinned card's detail panel (routes/
 *  history.bulgaria.tsx), which formats the same way rather than re-deriving it. */
export function formatCardDate(t: number, precision: TimelineEntry['precision']): string {
  const d = dateOfDecimalYear(t);
  if (precision === 'circa') return `c. ${yearLabel(d.year)}`;
  if (d.month == null) return yearLabel(d.year);
  return `${pad2(d.day ?? 1)}.${pad2(d.month)}.${yearLabel(d.year)}`;
}

/** "1887 – 1918 · 31 years" — duration via scale.ts's shared formatDuration. */
function formatRangeLine(startT: number, endT: number): string {
  const start = dateOfDecimalYear(startT).year;
  const end = dateOfDecimalYear(endT).year;
  return `${yearLabel(start)} – ${yearLabel(end)} · ${formatDuration(startT, endT)}`;
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
      <HistoryCardBody entry={entry} entries={entries} />
    </div>
  );
}

/** The card's content, by entry kind — shared between the hover card above and the
 *  pinned card below (routes/atlas.tsx), which show identical content, just inside a
 *  different (draggable, closable) shell. */
export function HistoryCardBody({ entry, entries }: { entry: TimelineEntry; entries: readonly TimelineEntry[] }) {
  return (
    <>
      {entry.kind === 'event' && <EventBody entry={entry} entries={entries} />}
      {(entry.kind === 'ruler' || entry.kind === 'government') && <RulerBody entry={entry} />}
      {entry.kind === 'period' && <PeriodBody entry={entry} />}
    </>
  );
}

function clampPx(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

export interface PinnedHistoryCardProps {
  entry: TimelineEntry;
  /** The whole dataset — passed straight through to HistoryCardBody, see its own doc. */
  entries: readonly TimelineEntry[];
  /** The clicked region's rect (same shape as HistoryCardProps.rect) — only used once, to
   *  place the card the first time it renders; dragging afterwards is the card's own state. */
  initialRect: { x: number; y: number; w: number; h: number };
  bounds: { width: number; height: number };
  /** CSS z-index — atlas.tsx bumps this on pin/click/drag so the card reads as "in front". */
  zIndex: number;
  /** The live timeline instance, for the "locate" button — flies the canvas back to this
   *  entry's own position, the same fly-to HistoryDetail's "Show on timeline" uses. Null
   *  before the canvas has mounted, in which case the button is a no-op. */
  timeline: HistoryTimeline | null;
  onClose: (id: string) => void;
  onFront: (id: string) => void;
  onSeeMore: (id: string) => void;
  /** Reports this card's own current rect (CARD_WIDTH × measured height, at its current
   *  left/top) on mount and on every drag move — atlas.tsx forwards it straight to
   *  HistoryTimeline.setPinnedCardRects so the connector line (renderer.ts) tracks the
   *  card live, including mid-drag. */
  onRectChange: (id: string, rect: { x: number; y: number; w: number; h: number }) => void;
}

/**
 * A pinned, draggable, closable version of the hover card — click-to-pin's on-canvas
 * result (see app/lib/history/timeline.ts's onEntryClick and CLAUDE.md's "pinned cards"
 * brief). Positioned the same way HistoryCard is on first render (measured height, flipped
 * off the canvas edges), then freely draggable by its header or body, clamped inside the
 * canvas at every step. Bringing to front, closing and "See more" are all owned by the
 * parent (atlas.tsx) — this component only reports the intent.
 */
export function PinnedHistoryCard({ entry, entries, initialRect, bounds, zIndex, timeline, onClose, onFront, onSeeMore, onRectChange }: PinnedHistoryCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; origLeft: number; origTop: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cardH = el.offsetHeight;

    let left = initialRect.x + initialRect.w + GAP_PX;
    if (left + CARD_WIDTH > bounds.width - EDGE_MARGIN_PX) left = initialRect.x - CARD_WIDTH - GAP_PX;
    left = clampPx(left, EDGE_MARGIN_PX, bounds.width - CARD_WIDTH - EDGE_MARGIN_PX);

    let top = initialRect.y + initialRect.h / 2 - cardH / 2;
    if (top + cardH > bounds.height - EDGE_MARGIN_PX) top = initialRect.y - cardH - GAP_PX;
    top = clampPx(top, EDGE_MARGIN_PX, bounds.height - cardH - EDGE_MARGIN_PX);

    setPos({ left, top });
    onRectChange(entry.id, { x: left, y: top, w: CARD_WIDTH, h: cardH });
    // Placed once, on mount — a card instance is keyed by entry id (atlas.tsx), so this
    // never needs to re-run for the same card; afterwards its position is its own drag state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    onFront(entry.id);
    // Only the primary (left) button starts a drag — a middle-click closes the card
    // instead (see onMiddleMouseDown/onMiddleClick below) and must not also pick it up.
    if (e.button !== 0 || (e.target as HTMLElement).closest('button') || !pos || !ref.current) return;
    ref.current.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, origLeft: pos.left, origTop: pos.top };
  };

  // Middle mouse click (scroll-wheel press) anywhere on the card closes it — plain mouse
  // events, not pointer events, since it's auxclick (fired after mouseup for a non-primary
  // button) that's the reliable cross-browser signal; mousedown only needs preventDefault
  // so the browser's autoscroll circle never appears. mouseup is handled too as a fallback
  // for the rare case a browser doesn't dispatch auxclick.
  const onMiddleMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.button === 1) e.preventDefault();
  };

  const onMiddleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.button === 1) onClose(entry.id);
  };

  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !ref.current) return;
    const cardH = ref.current.offsetHeight;
    const left = clampPx(drag.origLeft + (e.clientX - drag.startClientX), 0, Math.max(0, bounds.width - CARD_WIDTH));
    const top = clampPx(drag.origTop + (e.clientY - drag.startClientY), 0, Math.max(0, bounds.height - cardH));
    setPos({ left, top });
    onRectChange(entry.id, { x: left, y: top, w: CARD_WIDTH, h: cardH });
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const locate = (): void => {
    if (!timeline) return;
    const { centre, pxPerYear } = flyTargetFor(entry, timeline.viewportSizePx);
    timeline.flyTo(centre, pxPerYear, entry.id);
  };

  return (
    <div
      ref={ref}
      className="pinned-card"
      style={{ left: pos?.left ?? initialRect.x, top: pos?.top ?? initialRect.y, visibility: pos ? 'visible' : 'hidden', zIndex }}
      onPointerDown={startDrag}
      onPointerMove={onDragMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onMouseDown={onMiddleMouseDown}
      onMouseUp={onMiddleClick}
      onAuxClick={onMiddleClick}
    >
      <div className="pinned-card__header">
        <button type="button" className="pinned-card__locate" aria-label="Show on timeline" onClick={locate}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="8" cy="8" r="6.2" />
            <path d="M8 1.5v2.4M8 12.1v2.4M1.5 8h2.4M12.1 8h2.4" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="pinned-card__close" aria-label="Close" onClick={() => onClose(entry.id)}>
          ×
        </button>
      </div>
      <div className="pinned-card__body">
        <HistoryCardBody entry={entry} entries={entries} />
      </div>
      <div className="pinned-card__footer">
        <button type="button" className="pinned-card__see-more" onClick={() => onSeeMore(entry.id)}>
          See more
        </button>
      </div>
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
