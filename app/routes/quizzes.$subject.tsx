/**
 * The quiz list for one subject — geography's three quizzes; for History this same file
 * serves two more levels (see the default export): /quizzes/history is a list of countries
 * and /quizzes/history/:slug (a second route id, routes.ts) is that country's quizzes. Listed
 * compact (name only); clicking a name expands its scope chips, size ladder and history
 * inline, one quiz open at a time. Same markup on desktop's right panel and the phone sheet
 * (app.css handles the width difference). See CLAUDE.md's Quizzes section and
 * docs/quizzes.md's "Route shape".
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";

import {
  bestQuizTime,
  deleteQuizRun,
  listQuizRuns,
  type QuizRunEntry,
} from "~/lib/core/progress";
import { formatDuration } from "~/lib/format";
import { pageMeta } from "~/lib/seo";
import { subjectById } from "~/lib/quiz/subjects";
import { NAME_ALL_ID, NAME_ALL_QUIZ, type QuizSelectionMode } from "~/lib/geography/quizzes";
import {
  poolForQuiz,
  QUIZ_SCOPES,
  SCOPE_LABELS,
  sizesForPool,
  type QuizScope,
  type QuizSize,
} from "~/lib/geography/scopes";
import { allCountries } from "~/lib/geography/catalog.server";
import { fillQuizzes } from "~/lib/history/catalog.server";
import { HISTORY_COUNTRIES, historyCountryFor } from "~/lib/history/countries";
import { peekWorld } from "~/lib/geography/world";
import type { Route } from "./+types/quizzes.$subject";

type ScopeCounts = Record<QuizScope, number>;
/** Pool sizes per quiz id, then scope — a facet quiz's pool is narrower than the continent's
 *  (a missing or disputed value is out), so the size ladder is per quiz, not per scope. */
type PoolCounts = Record<string, ScopeCounts>;

/** One row of History's list: enough to draw and link a "fill the list" quiz, without
 *  shipping every entry to a page that only lists them. */
interface FillSummary {
  id: string;
  slug: string;
  title: string;
  kind: "ruler" | "government";
  count: number;
}

interface ListData {
  scopeCounts: PoolCounts;
  fill: FillSummary[];
}

const summariseFill = (): FillSummary[] =>
  fillQuizzes().map((q) => ({
    id: q.id,
    slug: q.slug,
    title: q.title,
    kind: q.kind,
    count: q.entries.length,
  }));

/** Every quiz's pool size per scope, from a country list — the size ladders are derived
 *  from these. */
function poolCounts(countries: Parameters<typeof poolForQuiz>[0]): PoolCounts {
  const ids = [...(subjectById("geography")?.quizzes ?? []).map((q) => q.id), NAME_ALL_ID];
  return Object.fromEntries(
    ids.map((id) => [
      id,
      Object.fromEntries(
        QUIZ_SCOPES.map((scope) => [scope, poolForQuiz(countries, id, scope).length]),
      ) as ScopeCounts,
    ]),
  );
}

/** The pool sizes, read from the shipped catalogue at build time, plus History's generated
 *  quiz list. Both are static; a subject uses only the half that is its own. */
export function loader(): ListData {
  return { scopeCounts: poolCounts(allCountries()), fill: summariseFill() };
}

export async function clientLoader({
  serverLoader,
}: Route.ClientLoaderArgs): Promise<ListData> {
  const world = peekWorld();
  if (!world) return serverLoader();
  // the History list has no in-memory source: it is only ever fetched from the prerendered data
  const { fill } = await serverLoader();
  return { scopeCounts: poolCounts(world.data.countries), fill };
}

export function meta({ params }: Route.MetaArgs) {
  const subject = params.subject ? subjectById(params.subject) : undefined;
  if (params.slug) {
    const country = historyCountryFor(params.slug);
    return country
      ? pageMeta({
          title: `${country.nameEn} History Quizzes — Zemya`,
          description: `Timed ${country.adjectiveEn} history quizzes: name every ruler, president or prime minister from their dates.`,
          path: `/quizzes/history/${country.slug}`,
        })
      : pageMeta({
          title: "Quizzes — Zemya",
          description: "No such country.",
          path: `/quizzes/history/${params.slug}`,
          noindex: true,
        });
  }
  if (!subject) {
    return pageMeta({
      title: "Quizzes — Zemya",
      description: "No such subject.",
      path: `/quizzes/${params.subject}`,
      noindex: true,
    });
  }
  return pageMeta({
    title: `${subject.name} Quizzes — Zemya`,
    description: subject.fillQuizzes
      ? `Timed ${subject.name.toLowerCase()} quizzes: pick a country, then name every ruler, president or prime minister from their dates.`
      : `Timed ${subject.name.toLowerCase()} quizzes: ${subject.quizzes.map((q) => q.title).join(", ")}.`,
    path: `/quizzes/${subject.id}`,
  });
}

/** dd.mm.yyyy, whatever the browser's locale. */
function formatRunDate(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const bestKey = (quizId: string, scope: QuizScope, size: QuizSize) =>
  `${quizId}:${scope}:${size}`;

/** Must match .quiz-sizes' column count in app.css — passed in as --cols so the CSS
 *  min-height and this row count are computed from the same number. */
const SIZE_COLUMNS = 3;

function QuizList({
  params,
  loaderData,
}: Route.ComponentProps) {
  const { scopeCounts } = loaderData;
  const subject = params.subject ? subjectById(params.subject) : undefined;

  /** Rows in the tallest size grid any scope can produce — every quiz's grid reserves this
   *  much height, so choosing a smaller scope never moves the quiz below it. */
  const maxRows = Math.max(
    1,
    ...Object.values(scopeCounts).flatMap((counts) =>
      QUIZ_SCOPES.map((scope) =>
        Math.ceil(sizesForPool(counts[scope]).length / SIZE_COLUMNS),
      ),
    ),
  );
  /** Which quiz's options are expanded — one at a time, collapsed by default. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** Chosen scope per quiz; every quiz keeps its own chip row across collapses. */
  const [scopes, setScopes] = useState<Record<string, QuizScope>>({});
  const scopeOf = (quizId: string): QuizScope => scopes[quizId] ?? "world";
  const [selectionModes, setSelectionModes] = useState<
    Record<string, QuizSelectionMode>
  >({});
  const selectionModeOf = (quizId: string): QuizSelectionMode =>
    selectionModes[quizId] ?? "random";

  /** {quizId}:{scope}:{size} -> fastest recorded time, or null. Starts empty and fills in
   *  after mount — IndexedDB doesn't exist during prerender, so the first render (and its
   *  hydration match) simply shows no best times yet, same as a genuinely new browser. */
  const [bestTimes, setBestTimes] = useState<Record<string, number | null>>({});
  const [history, setHistory] = useState<{
    quizId: string;
    scope: QuizScope;
    size: QuizSize;
  } | null>(null);
  const [runs, setRuns] = useState<QuizRunEntry[]>([]);
  const refreshBestTimes = useCallback(
    async (quizId: string, scope: QuizScope) => {
      const entries = await Promise.all(
        sizesForPool(scopeCounts[quizId][scope]).map(
          async (size) =>
            [
              bestKey(quizId, scope, size),
              await bestQuizTime(quizId, scope, size),
            ] as const,
        ),
      );
      setBestTimes((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    },
    [scopeCounts],
  );

  // An opened quiz brings its options into view (on a phone the list is longer than the sheet).
  // Also when the sheet has only just opened: it scrolls once the panel reaches full.
  useEffect(() => {
    if (!openId) return;
    const scroll = () =>
      document
        .querySelector<HTMLElement>(`[data-quiz-id="${openId}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const panel = document.querySelector<HTMLElement>('.panel');
    scroll();
    if (!panel) return;
    let wasFull = panel.dataset.snap === 'full';
    const observer = new MutationObserver(() => {
      const full = panel.dataset.snap === 'full';
      if (full && !wasFull) scroll();
      wasFull = full;
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['data-snap'] });
    return () => observer.disconnect();
  }, [openId]);

  useEffect(() => {
    if (!openId || !subject) return;
    refreshBestTimes(openId, scopes[openId] ?? "world");
  }, [refreshBestTimes, scopes, openId, subject]);

  async function openHistory(quizId: string, scope: QuizScope, size: QuizSize) {
    setHistory({ quizId, scope, size });
    setRuns(await listQuizRuns(quizId, scope, size));
  }

  async function handleDelete(run: QuizRunEntry) {
    if (run.id === undefined || !history) return;
    if (!window.confirm(`Delete this run (${formatDuration(run.timeMs)})?`))
      return;
    await deleteQuizRun(run.id);
    const { quizId, scope, size } = history;
    const [freshRuns, freshBest] = await Promise.all([
      listQuizRuns(quizId, scope, size),
      bestQuizTime(quizId, scope, size),
    ]);
    setRuns(freshRuns);
    setBestTimes((prev) => ({
      ...prev,
      [bestKey(quizId, scope, size)]: freshBest,
    }));
  }

  if (!subject) {
    return (
      <>
        <header className="panel__head">
          <span className="panel__eyebrow">Quizzes</span>
          <h2>Not found</h2>
        </header>
        <div className="panel__body">
          <div className="empty">
            <div className="empty__icon">?</div>
            <p>There is no subject called "{params.subject}".</p>
          </div>
          <Link to="/quizzes" className="action">
            Back to subjects
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="panel__head panel__head--quiet panel__head--peek">
        <span className="panel__eyebrow">
          <Link to="/quizzes">Quizzes</Link> · {subject.name}
        </span>
        <h2>Pick a quiz</h2>
        {/* phone layout only: the sheet's lowest snap point */}
        <div className="peek">
          <div className="peek__text">
            <div className="peek__title">{subject.name}</div>
            <div className="peek__sub">
              Timed rounds, one tap to start
            </div>
          </div>
        </div>
      </header>
      <div className="panel__body">
        {subject.quizzes.length === 0 ? (
          <div className="empty">
            <div className="empty__icon">🕓</div>
            <p>There are no {subject.name} quizzes yet.</p>
            <Link to="/quizzes" className="action">
              Back to subjects
            </Link>
          </div>
        ) : (
          <div className="quiz-list">
            {/* "Name all countries" is geography's one quiz that is not a QuizDefinition */}
            {(subject.id === "geography" ? [...subject.quizzes, NAME_ALL_QUIZ] : subject.quizzes).map((quiz) => {
              const nameAll = quiz.id === NAME_ALL_ID;
              const open = openId === quiz.id;
              const scope = scopeOf(quiz.id);
              const selectionMode = selectionModeOf(quiz.id);
              const poolSize = scopeCounts[quiz.id][scope];
              return (
                <section key={quiz.id} data-quiz-id={quiz.id} className="quiz-list__item">
                  <button
                    type="button"
                    className="quiz-list__row"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : quiz.id)}
                  >
                    <span className="quiz-list__name">{quiz.title}</span>
                    <span className="quiz-list__chevron" aria-hidden="true">
                      {open ? "−" : "+"}
                    </span>
                  </button>

                  {open && (
                    <div className="quiz-list__body">
                      <p className="quiz-desc">{quiz.description}</p>

                      <div
                        className="chips quiz-scope"
                        role="group"
                        aria-label={`${quiz.title} — region`}
                      >
                        {QUIZ_SCOPES.map((option) => (
                          <button
                            key={option}
                            type="button"
                            className="chip"
                            aria-pressed={scope === option}
                            onClick={() =>
                              setScopes((prev) => ({
                                ...prev,
                                [quiz.id]: option,
                              }))
                            }
                          >
                            {SCOPE_LABELS[option]}
                          </button>
                        ))}
                      </div>

                      {!nameAll && (
                      <div
                        className="chips quiz-order"
                        role="group"
                        aria-label={`${quiz.title} — country order`}
                      >
                        <button
                          type="button"
                          className="chip"
                          aria-pressed={selectionMode === "population"}
                          onClick={() =>
                            setSelectionModes((prev) => ({
                              ...prev,
                              [quiz.id]:
                                selectionMode === "random"
                                  ? "population"
                                  : "random",
                            }))
                          }
                        >
                          {selectionMode === "random" ? "Random" : "Population"}
                        </button>
                      </div>
                      )}

                      <div
                        className="quiz-sizes"
                        style={
                          {
                            "--cols": SIZE_COLUMNS,
                            "--max-rows": maxRows,
                          } as CSSProperties
                        }
                      >
                        {(nameAll ? (["all"] as QuizSize[]) : sizesForPool(poolSize)).map((size) => {
                          const best = bestTimes[bestKey(quiz.id, scope, size)];
                          return (
                            <div key={size} className="quiz-size-card">
                              <Link
                                className="quiz-size-card__link"
                                to={`/quizzes/${subject.id}/${quiz.id}/${scope}/${size}${!nameAll && selectionMode === "population" ? "?order=population" : ""}`}
                              >
                                <span className="quiz-size-card__n">
                                  {size === "all" ? "All" : size}
                                </span>
                                <span className="quiz-size-card__label">
                                  {nameAll
                                    ? `${poolSize} countries`
                                    : size === "all"
                                      ? `${poolSize} rounds`
                                      : "rounds"}
                                </span>
                              </Link>
                              {best != null && (
                                <button
                                  type="button"
                                  className="quiz-size-card__best"
                                  onClick={() =>
                                    openHistory(quiz.id, scope, size)
                                  }
                                >
                                  {formatDuration(best)}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {history?.quizId === quiz.id &&
                        history.scope === scope && (
                          <div className="quiz-history">
                            <div className="quiz-history__head">
                              <h4>
                                {SCOPE_LABELS[history.scope]} ·{" "}
                                {history.quizId === NAME_ALL_ID
                                  ? "name all"
                                  : `${history.size === "all" ? "All" : history.size} rounds`}{" "}
                                — history
                              </h4>
                              <button
                                type="button"
                                className="quiz-history__close"
                                onClick={() => setHistory(null)}
                                aria-label="Close history"
                              >
                                ×
                              </button>
                            </div>
                            {runs.length === 0 ? (
                              <p className="quiz-history__empty">
                                No runs left.
                              </p>
                            ) : (
                              <ul className="quiz-history__list">
                                {runs.map((run) => (
                                  <li
                                    key={run.id}
                                    className="quiz-history__row"
                                  >
                                    <span className="quiz-history__date">
                                      {formatRunDate(run.at)}
                                    </span>
                                    <span className="quiz-history__time numeric">
                                      {formatDuration(run.timeMs)}
                                    </span>
                                    <span className="quiz-history__tally">
                                      {run.firstTryCount}/{run.totalCount}{" "}
                                      {history.quizId === NAME_ALL_ID ? "named" : "first-try"}
                                    </span>
                                    <button
                                      type="button"
                                      className="quiz-history__delete"
                                      onClick={() => handleDelete(run)}
                                      aria-label="Delete this run"
                                    >
                                      ✕
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/** One file, three levels: the geography list (`/quizzes/geography`), History's country list
 *  (`/quizzes/history`) and one country's History quizzes (`/quizzes/history/:slug`, which
 *  has `:slug` and no `:subject`). Dispatching here keeps each component's hooks unconditional. */
export default function QuizzesRoute(props: Route.ComponentProps) {
  const { params, loaderData } = props;
  if (params.slug) return <HistoryCountryQuizzes slug={params.slug} fill={loaderData.fill} />;
  const subject = params.subject ? subjectById(params.subject) : undefined;
  if (subject?.fillQuizzes) return <HistoryCountries fill={loaderData.fill} />;
  return <QuizList {...props} />;
}

function NotFound({ what, eyebrow, back, backLabel }: { what: string; eyebrow: ReactNode; back: string; backLabel: string }) {
  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">{eyebrow}</span>
        <h2>Not found</h2>
      </header>
      <div className="panel__body">
        <div className="empty">
          <div className="empty__icon">?</div>
          <p>{what}</p>
        </div>
        <Link to={back} className="action">
          {backLabel}
        </Link>
      </div>
    </>
  );
}

/** /quizzes/history — the countries that have a timeline, from HISTORY_COUNTRIES. */
function HistoryCountries({ fill }: { fill: FillSummary[] }) {
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

/** /quizzes/history/:slug — the country's "fill the list" quizzes, in fill-quiz-config.ts's
 *  order, under a Rulers / Governments heading each. */
function HistoryCountryQuizzes({ slug, fill }: { slug: string; fill: FillSummary[] }) {
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
      <NotFound
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
