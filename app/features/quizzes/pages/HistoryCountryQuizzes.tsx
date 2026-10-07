import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { historyCountryFor } from '~/features/history';
import { bestQuizTime } from '~/features/progress';
import { formatDuration } from "~/shared/lib/format";
import { QuizNotFound } from './QuizNotFound';
import type { FillSummary } from './quiz-list-data';

/** /quizzes/history/:slug — the country's "fill the list" quizzes, in fill-quiz-config.ts's
 *  order, under a Rulers / Governments heading each. */
export function HistoryCountryQuizzes({ slug, fill }: { slug: string; fill: FillSummary[] }) {
  const country = historyCountryFor(slug);
  const list = useMemo(() => fill.filter((q) => q.slug === slug), [fill, slug]);
  /** quiz id -> fastest time (toggle off); fills in after mount, IndexedDB has no prerender. */
  const [best, setBest] = useState<Record<string, number | null>>({});
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      list.map(async (q) => [q.id, await bestQuizTime(q.id, "all", "all")] as const),
    ).then((entries) => {
      if (!cancelled) setBest(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [list]);

  if (!country) {
    return (
      <QuizNotFound
        what={`There is no history for "${slug}".`}
        eyebrow={<Link to="/quizzes/history">History</Link>}
        back="/quizzes/history"
        backLabel="Back to countries"
      />
    );
  }

  return (
    <>
      <header className="panel__head panel__head--quiet panel__head--peek">
        <span className="panel__eyebrow">
          <Link to="/quizzes">Quizzes</Link> · <Link to="/quizzes/history">History</Link> · {country.nameEn}
        </span>
        <h2>Pick a quiz</h2>
        {/* phone layout only: the sheet's lowest snap point */}
        <div className="peek">
          <div className="peek__text">
            <div className="peek__title">{country.nameEn}</div>
            <div className="peek__sub">Timed rounds, one tap to start</div>
          </div>
        </div>
      </header>
      <div className="panel__body">
        {(["ruler", "government"] as const).map((kind) => {
          const group = list.filter((q) => q.kind === kind);
          if (group.length === 0) return null;
          return (
            <section key={kind}>
              <h3 className="subhead">
                {kind === "ruler" ? "Rulers" : "Governments"} — fill the list
              </h3>
              <div className="quiz-list">
                {group.map((q) => (
                  <section key={q.id} className="quiz-list__item">
                    <Link className="quiz-list__row" to={`/quizzes/history/${slug}/${q.id}`}>
                      <span className="quiz-list__name">
                        {q.title}
                        <span className="quiz-list__meta">
                          {q.count} {kind === "ruler" ? "rulers" : "governments"}
                          {best[q.id] != null && ` · best ${formatDuration(best[q.id]!)}`}
                        </span>
                      </span>
                      <span className="quiz-list__chevron" aria-hidden="true">
                        ›
                      </span>
                    </Link>
                  </section>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
