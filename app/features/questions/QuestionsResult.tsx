import { Link } from 'react-router';

import { parseCardId, type Catalogue } from '~/features/countries';
import type { Round } from './use-question-session';

/** The end of a session: the score, the countries missed, and "Study again". */
export function QuestionsResult({ rounds, total, catalogue, onAgain }: {
  rounds: Round[];
  total: number;
  catalogue: Catalogue | null;
  onAgain: () => void;
}) {
  const right = rounds.filter(r => r.answer.correct).length;
  const missed = rounds.filter(r => !r.answer.correct);
  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">Questions</span>
        <h2>Session complete</h2>
      </header>
      <div className="panel__body">
        <div className="hook">
          <div className="hook__label">Result</div>
          <p>
            {right} / {total} correct
          </p>
        </div>

        {missed.length > 0 && (
          <section>
            <h3 className="subhead">Missed</h3>
            <div className="neighbours">
              {missed.map(({ question: q }) => {
                const parsed = parseCardId(q.cardId);
                const country = parsed ? catalogue?.byIso3.get(parsed.iso3) : null;
                if (!country) return null;
                return (
                  <Link className="neighbour" key={q.id} to={`/country/${country.slug}`}>
                    {country.emoji} {country.name}
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <button type="button" className="action action--primary" onClick={onAgain}>
          Study again
        </button>
      </div>
    </>
  );
}
