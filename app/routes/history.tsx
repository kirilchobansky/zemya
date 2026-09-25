/**
 * The History nav section's picker: which countries have a timeline. Renders into the
 * atlas layout's right-hand panel exactly like the quiz subject picker (routes/quizzes.tsx)
 * — the canvas underneath keeps showing the map until a country is picked (see
 * routes/history.bulgaria.tsx, which is what actually swaps it to the timeline).
 */
import { Link } from 'react-router';

import { pageMeta } from '~/lib/seo';
import { HISTORY_COUNTRIES } from '~/lib/history/countries';

export function meta() {
  return pageMeta({
    title: 'History — Zemya',
    description: 'Pick a country to open its history timeline.',
    path: '/history'
  });
}

export default function HistoryPicker() {
  return (
    <>
      <header className="panel__head panel__head--quiet panel__head--peek">
        <span className="panel__eyebrow">History</span>
        <h2>Pick a country</h2>
        {/* phone layout only: the sheet's lowest snap point */}
        <div className="peek">
          <div className="peek__text">
            <div className="peek__title">History</div>
            <div className="peek__sub">Pick a country to open its timeline</div>
          </div>
        </div>
      </header>
      <div className="panel__body">
        <div className="subject-list">
          {HISTORY_COUNTRIES.map(country => (
            <Link key={country.slug} to={`/history/${country.slug}`} className="subject-card">
              <span className="subject-card__name">{country.name}</span>
              <span className="subject-card__blurb">{country.range}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
