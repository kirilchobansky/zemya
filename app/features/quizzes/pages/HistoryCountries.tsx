import { Link } from "react-router";

import { HISTORY_COUNTRIES } from '~/features/history';
import type { FillSummary } from './quiz-list-data';

/** /quizzes/history — the countries that have a timeline, from HISTORY_COUNTRIES. */
export function HistoryCountries({ fill }: { fill: FillSummary[] }) {
  return (
    <>
      <header className="panel__head panel__head--quiet panel__head--peek">
        <span className="panel__eyebrow">
          <Link to="/quizzes">Quizzes</Link> · History
        </span>
        <h2>Pick a country</h2>
        {/* phone layout only: the sheet's lowest snap point */}
        <div className="peek">
          <div className="peek__text">
            <div className="peek__title">History</div>
            <div className="peek__sub">Pick a country</div>
          </div>
        </div>
      </header>
      <div className="panel__body">
        <div className="subject-list">
          {HISTORY_COUNTRIES.map((country) => {
            const count = fill.filter((q) => q.slug === country.slug).length;
            return (
              <Link
                key={country.slug}
                to={`/quizzes/history/${country.slug}`}
                className="subject-card"
              >
                <span className="subject-card__name">{country.nameEn}</span>
                <span className="subject-card__blurb">
                  {country.range}
                </span>
                <span className="subject-card__count">
                  {count} {count === 1 ? "quiz" : "quizzes"}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
