/**
 * A country's history timeline (/history/:slug). Renders into the atlas layout's right-hand panel like every
 * other child route; the canvas itself lives in routes/map/atlas.tsx (AtlasShell), which swaps
 * to the timeline the moment this route hands it entries over the shared context — the
 * same "child route drives the layout through AtlasContext" pattern the quiz run routes use
 * for setQuiz. No dossier, no hover, no selection, no quiz yet — canvas drawing only, same
 * as before this route joined the main nav (see CLAUDE.md's history exception).
 */
import { useEffect } from 'react';

import { HistoryDetail, HistoryFilters, HistoryOutline, HistorySearch, historyCountryFor } from '~/features/history';
import { timelineFor } from '~/features/history/data/catalog.server';
import { pageMeta } from '~/shared/lib/seo';
import { useAtlasContext } from '~/features/map';
import type { Route } from './+types/history.$slug';

export function loader({ params }: Route.LoaderArgs) {
  const country = historyCountryFor(params.slug);
  if (!country) throw new Response('Not found', { status: 404 });
  return { country, entries: timelineFor(country.slug) };
}

export function meta({ loaderData, location }: Route.MetaArgs) {
  const country = loaderData?.country;
  return pageMeta({
    title: `${country?.nameEn ?? 'History'} — ${country?.lang === 'en' ? 'history' : 'история'} — Zemya`,
    description: country
      ? `An interactive timeline of ${country.adjectiveEn} history, ${country.startYear} to today.`
      : 'An interactive timeline of history.',
    path: location.pathname
  });
}

export default function HistoryCountryPanel({ loaderData }: Route.ComponentProps) {
  const { country, entries } = loaderData;
  const {
    setTimelineEntries, setTimelineLabels, historyPinnedIds, closeAllHistoryCards, selectedHistoryEntryId, setSelectedHistoryEntryId,
    pinHistoryEntry, historyTimeline, historyCurrentPeriodId,
    historyHiddenKinds, toggleHistoryKind, historyHiddenCategories, toggleHistoryCategory, resetHistoryFilters
  } = useAtlasContext();

  useEffect(() => {
    setTimelineLabels({ pastLabel: country.pastLabel, futureLabel: country.futureLabel });
    setTimelineEntries(entries);
    return () => setTimelineEntries(null);
  }, [entries, country, setTimelineEntries, setTimelineLabels]);

  const selectedEntry = selectedHistoryEntryId ? entries.find(e => e.id === selectedHistoryEntryId) ?? null : null;

  return (
    <>
      <header className="panel__head panel__head--quiet panel__head--peek">
        <span className="panel__eyebrow">History</span>
        <h2>{country.nameEn}</h2>
        <div className="peek">
          <div className="peek__text">
            <div className="peek__title">{country.nameEn}</div>
            <div className="peek__sub">{country.startYear} – today · {entries.length} entries</div>
          </div>
        </div>
      </header>
      <div className="panel__body">
        <HistorySearch lang={country.lang} entries={entries} timeline={historyTimeline} onOpen={setSelectedHistoryEntryId} />
        <HistoryFilters
          hiddenKinds={historyHiddenKinds}
          onToggleKind={toggleHistoryKind}
          hiddenCategories={historyHiddenCategories}
          onToggleCategory={toggleHistoryCategory}
          onReset={resetHistoryFilters}
        />
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
