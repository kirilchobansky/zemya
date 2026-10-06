/**
 * Filter chips for the history panel (routes/history/history.$slug.tsx, below
 * HistorySearch) — kind toggles (periods excluded: always shown, per CLAUDE.md/the
 * filters brief) and event category toggles, all on by default. State lives in
 * AtlasContext (routes/map/atlas.tsx) and is only ever read there — same convention as
 * HistoryOutline/HistoryDetail, which take their own slice of it as plain props rather
 * than calling useAtlasContext themselves — so it survives a "See more" swap to the
 * detail view and resets only when the history route itself is left.
 *
 * Category ids, labels and colours are copied from content/history/events-bg.json's own
 * categories[] (the source of record CLAUDE.md's content conventions ask for — that file
 * itself is still never read at runtime, per catalog.server.ts's own note; these are just
 * its 9 authored values, transcribed once) — kept in sync with CATEGORY_LABELS
 * (HistoryCard.tsx), which has the same 9 ids without the colour.
 */
import type { EntryKind } from '~/features/history/timeline/scale';
import './HistoryFilters.css';

const KIND_CHIPS: readonly { id: EntryKind; label: string }[] = [
  { id: 'ruler', label: 'Rulers' },
  { id: 'government', label: 'Governments' },
  { id: 'event', label: 'Events' }
];

const CATEGORY_CHIPS: readonly { id: string; label: string; color: string }[] = [
  { id: 'war', label: 'War', color: '#b3261e' },
  { id: 'treaty', label: 'Treaty', color: '#1f5fa8' },
  { id: 'uprising', label: 'Uprising', color: '#c1272d' },
  { id: 'church', label: 'Church', color: '#6a4a8a' },
  { id: 'culture', label: 'Culture', color: '#2e7d4f' },
  { id: 'politics', label: 'Politics', color: '#5a6b7a' },
  { id: 'economy', label: 'Economy', color: '#b8860b' },
  { id: 'disaster', label: 'Disaster', color: '#8a4a1a' },
  { id: 'ruler', label: 'Ruler', color: '#7a5c3e' }
];

export interface HistoryFiltersProps {
  hiddenKinds: ReadonlySet<EntryKind>;
  onToggleKind: (kind: EntryKind) => void;
  hiddenCategories: ReadonlySet<string>;
  onToggleCategory: (category: string) => void;
  onReset: () => void;
}

export default function HistoryFilters({ hiddenKinds, onToggleKind, hiddenCategories, onToggleCategory, onReset }: HistoryFiltersProps) {
  const anyHidden = hiddenKinds.size > 0 || hiddenCategories.size > 0;

  return (
    <div className="history-filters">
      <div className="chips">
        {KIND_CHIPS.map(k => (
          <button
            key={k.id}
            type="button"
            className="chip"
            aria-pressed={!hiddenKinds.has(k.id)}
            onClick={() => onToggleKind(k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="chips">
        {CATEGORY_CHIPS.map(c => (
          <button
            key={c.id}
            type="button"
            className="chip history-filters__category"
            aria-pressed={!hiddenCategories.has(c.id)}
            onClick={() => onToggleCategory(c.id)}
          >
            <span className="history-filters__dot" style={{ background: c.color }} />
            {c.label}
          </button>
        ))}
        {anyHidden && (
          <button type="button" className="chip history-filters__reset" onClick={onReset}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
