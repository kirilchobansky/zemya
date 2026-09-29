/**
 * Bulgaria's history timeline. Renders into the atlas layout's right-hand panel like every
 * other child route; the canvas itself lives in routes/atlas.tsx (AtlasShell), which swaps
 * to the timeline the moment this route hands it entries over the shared context — the
 * same "child route drives the layout through AtlasContext" pattern the quiz run routes use
 * for setQuiz. No dossier, no hover, no selection, no quiz yet — canvas drawing only, same
 * as before this route joined the main nav (see CLAUDE.md's history exception).
 */
import { useEffect } from 'react';

import { CATEGORY_LABELS, formatCardDate } from '~/components/HistoryCard';
import HistoryOutline from '~/components/HistoryOutline';
import { bulgariaTimeline } from '~/lib/history/catalog.server';
import type { TimelineEntry } from '~/lib/history/renderer';
import { pageMeta } from '~/lib/seo';
import { useAtlasContext } from './atlas';
import type { Route } from './+types/history.bulgaria';

export function loader() {
  return { entries: bulgariaTimeline() };
}

export function meta({ location }: Route.MetaArgs) {
  return pageMeta({
    title: 'Bulgaria — история — Zemya',
    description: 'An interactive timeline of Bulgarian history, 681 to today.',
    path: location.pathname
  });
}

export default function HistoryBulgariaPanel({ loaderData }: Route.ComponentProps) {
  const { entries } = loaderData;
  const {
    setTimelineEntries, historyPinnedIds, closeAllHistoryCards, selectedHistoryEntryId, setSelectedHistoryEntryId,
    historyTimeline, historyCurrentPeriodId
  } = useAtlasContext();

  useEffect(() => {
    setTimelineEntries(entries);
    return () => setTimelineEntries(null);
  }, [entries, setTimelineEntries]);

  const selectedEntry = selectedHistoryEntryId ? entries.find(e => e.id === selectedHistoryEntryId) ?? null : null;

  return (
    <>
      <header className="panel__head panel__head--quiet panel__head--peek">
        <span className="panel__eyebrow">History</span>
        <h2>Bulgaria</h2>
        <div className="peek">
          <div className="peek__text">
            <div className="peek__title">Bulgaria</div>
            <div className="peek__sub">681 – today · {entries.length} entries</div>
          </div>
        </div>
      </header>
      <div className="panel__body">
        <div className="history-outline__actions">
          <button type="button" className="action" onClick={() => historyTimeline?.flyToWholeHistory()}>
            Whole history
          </button>
          <button type="button" className="action" onClick={() => historyTimeline?.flyToToday()}>
            Today
          </button>
          {historyPinnedIds.length > 0 && (
            <button type="button" className="action" onClick={closeAllHistoryCards}>
              Close all cards ({historyPinnedIds.length})
            </button>
          )}
        </div>

        {selectedEntry ? (
          <EntryDetail entry={selectedEntry} onBack={() => setSelectedHistoryEntryId(null)} />
        ) : (
          <HistoryOutline entries={entries} currentPeriodId={historyCurrentPeriodId} timeline={historyTimeline} />
        )}
      </div>
    </>
  );
}

/** Plain detail view for a pinned card's "See more" — full, unclamped content in the
 *  sidebar rather than the card's own 3-line summary. "The bigger layout for this comes in
 *  a later step" (see the prompt this shipped from), so this is deliberately plain: no new
 *  layout, just the same fields the card already carries, spelled out in full. */
function EntryDetail({ entry, onBack }: { entry: TimelineEntry; onBack: () => void }) {
  const categoryLabel = entry.category ? CATEGORY_LABELS[entry.category] ?? entry.category : null;
  const dateLine =
    entry.end != null && entry.end !== entry.start
      ? `${formatCardDate(entry.start, entry.precision)} – ${formatCardDate(entry.end, entry.precision)}`
      : formatCardDate(entry.start, entry.precision);

  return (
    <div className="entry-detail">
      <h3>{entry.label}</h3>
      {entry.role && <p className="history-card__role">{entry.role}</p>}
      <p className="history-card__date">{dateLine}</p>
      {categoryLabel && (
        <p className="history-card__category">
          <span className="history-card__dot" style={{ background: entry.color ?? 'var(--ink-3)' }} />
          {categoryLabel}
        </p>
      )}
      {entry.blurbBg && <p>{entry.blurbBg}</p>}
      {entry.tags.length > 0 && (
        <div className="chips">
          {entry.tags.map(tag => (
            <span key={tag} className="chip">{tag}</span>
          ))}
        </div>
      )}
      <button type="button" className="action" onClick={onBack}>
        Back
      </button>
    </div>
  );
}
