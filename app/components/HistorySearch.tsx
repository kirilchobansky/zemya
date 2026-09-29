/**
 * Search box for the Bulgaria history panel (routes/history.bulgaria.tsx, above
 * HistoryFilters) — a thin UI shell over the pure app/lib/history/search.ts. Mirrors
 * components/SearchBox.tsx's shape (same keyboard handling, same "glass" results dropdown)
 * but flies the history canvas and opens HistoryDetail instead of navigating.
 */
import { useEffect, useRef, useState } from 'react';

import { formatCardDate } from './HistoryCard';
import { search } from '~/lib/history/search';
import { flyTargetFor, type HistoryTimeline } from '~/lib/history/timeline';
import type { TimelineEntry } from '~/lib/history/renderer';

const RESULT_LIMIT = 8;

/** Dot colour when an entry has none of its own (entry.color — events only): one flat
 *  swatch per kind, echoing renderer.ts's RULER_BASE/GOVERNMENT_BASE/EVENT_BASE accents
 *  (not imported — those are canvas-only literals, not exported) and a mid PERIOD_BASE
 *  tone for periods (which never carry entry.color in every case — pre-state ones don't). */
const KIND_DOT_COLOR: Readonly<Record<TimelineEntry['kind'], string>> = {
  period: '#8c6239',
  ruler: '#2fd0ff',
  government: '#b98bff',
  event: '#ffb347'
};

export interface HistorySearchProps {
  entries: readonly TimelineEntry[];
  /** Null only for the brief window before the canvas controller mounts (same convention
   *  as HistoryOutline/HistoryDetail) — a result click still opens the detail view, it just
   *  can't fly the canvas until this is set. */
  timeline: HistoryTimeline | null;
  /** Opens the matched entry's detail view (routes/history.bulgaria.tsx's
   *  setSelectedHistoryEntryId) — the same "clicking it behaves like clicking it on the
   *  timeline" convention HistoryDetail's own rows use. */
  onOpen: (id: string) => void;
}

export default function HistorySearch({ entries, timeline, onOpen }: HistorySearchProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = search(entries, query, RESULT_LIMIT);

  useEffect(() => setActive(0), [query]);

  // "Pressing '/' anywhere on the page focuses the search box" — skipped while another
  // text input already has focus, so it can't hijack typing elsewhere in the panel.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== '/') return;
      const target = e.target;
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function choose(entry: TimelineEntry | undefined) {
    if (!entry) return;
    onOpen(entry.id);
    if (timeline) {
      const { centre, pxPerYear } = flyTargetFor(entry, timeline.viewportSizePx);
      timeline.flyTo(centre, pxPerYear, entry.id);
    }
    setQuery('');
    setActive(0);
  }

  return (
    <div className="history-search">
      <span className="history-search__icon" aria-hidden="true">⌕</span>
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="Search people, events, periods (Latin or Cyrillic)"
        autoComplete="off"
        spellCheck={false}
        aria-label="Search the timeline"
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            // Own scope only — never lets the same Escape also close the front-most
            // pinned card (atlas.tsx's global listener).
            e.stopPropagation();
            setQuery('');
            return;
          }
          if (!results.length) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(results[active]);
          }
        }}
      />
      {query && (
        <div className="history-search__results glass" role="listbox">
          {results.length === 0 ? (
            <button type="button" disabled style={{ color: 'var(--ink-3)' }}>
              No match
            </button>
          ) : (
            results.map((entry, i) => (
              <button
                key={entry.id}
                type="button"
                role="option"
                aria-selected={i === active}
                data-active={i === active}
                onClick={() => choose(entry)}
              >
                <span className="history-search__dot" style={{ background: entry.color ?? KIND_DOT_COLOR[entry.kind] }} />
                <span className="history-search__name">{entry.label}</span>
                <span className="history-search__meta">
                  {formatCardDate(entry.start, entry.precision)}
                  {entry.role ? ` · ${entry.role}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
