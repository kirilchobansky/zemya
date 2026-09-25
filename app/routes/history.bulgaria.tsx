/**
 * Bulgaria's history timeline. Renders into the atlas layout's right-hand panel like every
 * other child route; the canvas itself lives in routes/atlas.tsx (AtlasShell), which swaps
 * to the timeline the moment this route hands it entries over the shared context — the
 * same "child route drives the layout through AtlasContext" pattern the quiz run routes use
 * for setQuiz. No dossier, no hover, no selection, no quiz yet — canvas drawing only, same
 * as before this route joined the main nav (see CLAUDE.md's history exception).
 */
import { useEffect } from 'react';
import { Link } from 'react-router';

import { bulgariaTimeline } from '~/lib/history/catalog.server';
import { HISTORY_COUNTRIES } from '~/lib/history/countries';
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
  const { setTimelineEntries } = useAtlasContext();

  useEffect(() => {
    setTimelineEntries(entries);
    return () => setTimelineEntries(null);
  }, [entries, setTimelineEntries]);

  return (
    <>
      <header className="panel__head panel__head--quiet panel__head--peek">
        <span className="panel__eyebrow">History</span>
        <h2>България</h2>
        <div className="peek">
          <div className="peek__text">
            <div className="peek__title">История</div>
            <div className="peek__sub">681 – днес</div>
          </div>
        </div>
      </header>
      <div className="panel__body">
        <div className="subject-list">
          {HISTORY_COUNTRIES.map(country => (
            <Link
              key={country.slug}
              to={`/history/${country.slug}`}
              className="subject-card"
              aria-current={country.slug === 'bulgaria' ? 'page' : undefined}
            >
              <span className="subject-card__name">{country.name}</span>
              <span className="subject-card__blurb">{country.range}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
