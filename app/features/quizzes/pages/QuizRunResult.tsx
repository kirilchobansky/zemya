import { Link } from "react-router";

import { formatDuration } from "~/shared/lib/format";
import type { CountryRecord } from "~/engines/map/types";
import type { QuizEngine } from '../engine/engine';

/** The results of a finished run: time, personal-best line, tally, the revealed countries and
 *  the buttons. */
export function QuizRunResult({ engine, total, backTo, onRunAgain }: {
  engine: QuizEngine;
  total: number;
  backTo: string;
  onRunAgain: () => void;
}) {
  const result = engine.result;
  if (!result) return null;
  return (
    <>
      <div className="hook">
        <div className="hook__label">Result</div>
        <p className="quiz-result__time numeric">
          {formatDuration(result.timeMs)}
        </p>
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
          Run it again
        </button>
        <Link to={backTo} state={{ sheet: "full" }} className="action desk-hide">
          Back to quizzes
        </Link>
      </div>
    </>
  );
}
