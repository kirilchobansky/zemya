import { Link } from "react-router";


import { formatDuration } from "~/shared/lib/format";
import type { CountryRecord } from "~/engines/map/types";
import type { QuizEngine } from '../engine/engine';
import { useResultsReturn } from '../engine/use-results-return';

/** The results of a finished run: time, personal-best line, tally, the revealed countries and
 *  the buttons. */
export function QuizRunResult({ engine, total, onRunAgain }: {
  engine: QuizEngine;
  total: number;
  onRunAgain: () => void;
}) {
  const result = engine.result;
  /* A missed country's dossier gets a Back to these results (use-results-return.ts). */
  const back = useResultsReturn(engine.snapshot, result);
  if (!result) return null;
  return (
    <>
      <div className="hook">
        <div className="hook__label">Result</div>
        <p className="quiz-result__time numeric">
          {formatDuration(result.timeMs)}
        </p>
        {engine.reviewing ? (
          <p style={{ marginBottom: 6 }}>
            Review pass — its time is added to this run in the archive as the next try. Never a personal best.
          </p>
        ) : (
          <p style={{ marginBottom: 6 }}>
            {result.beatBest ? (
              result.previousBest !== null ? (
                <>
                  New personal best — beat{" "}
                  <b>{formatDuration(result.previousBest)}</b>.
                </>
              ) : (
                <>
                  First run at this size —{" "}
                  <b>{formatDuration(result.timeMs)}</b> is now your
                  personal best.
                </>
              )
            ) : !result.perfect ? (
              <>
                Saved to the archive, not a best — a best needs every country on the first
                try, with no skip or reveal.
                {result.previousBest !== null && (
                  <> Best stays <b>{formatDuration(result.previousBest)}</b>.</>
                )}
              </>
            ) : (
              <>
                Personal best stays{" "}
                <b>
                  {formatDuration(
                    result.previousBest ?? result.timeMs,
                  )}
                </b>
                .
              </>
            )}
          </p>
        )}
        <p>
          <b>{result.firstTryCount}</b> first-try,{" "}
          <b>{result.revealed.length}</b> revealed (of{" "}
          {total}).
        </p>
      </div>

      {result.revealed.length > 0 && (
        <section>
          <h3 className="subhead">
            Revealed — the ones worth another look
          </h3>
          <div className="neighbours">
            {result.revealed.map((country: CountryRecord) => (
              <Link
                className="neighbour"
                key={country.iso3}
                to={`/country/${country.slug}`}
                {...back}
              >
                {country.emoji} {country.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="actions">
        <button
          type="button"
          className="action action--primary"
          onClick={onRunAgain}
        >
          Try again
        </button>
        {result.revealed.length > 0 && (
          <button type="button" className="action" onClick={engine.reviewMistakes}>
            Review mistakes ({result.revealed.length})
          </button>
        )}
      </div>
    </>
  );
}
