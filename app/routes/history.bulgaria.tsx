/**
 * Bulgaria's history timeline. Renders into the atlas layout's right-hand panel like every
 * other child route; the canvas itself lives in routes/atlas.tsx (AtlasShell), which swaps
 * to the timeline the moment this route hands it entries over the shared context — the
 * same "child route drives the layout through AtlasContext" pattern the quiz run routes use
 * for setQuiz. No dossier, no hover, no selection, no quiz yet — canvas drawing only, same
 * as before this route joined the main nav (see CLAUDE.md's history exception).
 */
import { useEffect } from 'react';

import HistoryDetail from '~/components/HistoryDetail';
import HistoryOutline from '~/components/HistoryOutline';
import { bulgariaTimeline } from '~/lib/history/catalog.server';
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
    pinHistoryEntry, historyTimeline, historyCurrentPeriodId
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
          <HistoryDetail
            key={selectedEntry.id}
            entry={selectedEntry}
            entries={entries}
            timeline={historyTimeline}
            onOpen={setSelectedHistoryEntryId}
            onBack={() => setSelectedHistoryEntryId(null)}
            onPin={pinHistoryEntry}
          />
        ) : (
          <HistoryOutline entries={entries} currentPeriodId={historyCurrentPeriodId} timeline={historyTimeline} />
        )}
      </div>
    </>
  );
}
