/**
 * One route for every quiz — /quizzes/:subject/:quizId/:scope/:size — looked up by id
 * within its subject (app/features/quizzes/engine/subjects.tsx, backed by app/features/quizzes/geography/quizzes.ts's
 * QUIZ_DEFINITIONS for geography). All the run logic (queue, timer, pause/resume, abandon,
 * grading, results, personal best) lives in the shared engine (app/features/quizzes/engine/engine.ts),
 * and the run screen itself in features/quizzes/pages/QuizRun.tsx. This file is the route:
 * loader, clientLoader, meta, and the dispatch between the three kinds of run. See
 * CLAUDE.md's Quizzes section.
 */
import { Link } from "react-router";
import { useParams } from "react-router";

import { allCountries } from "~/features/countries/catalog.server";
import { fillQuizzes } from "~/features/quizzes/history-fill/fill-quizzes.server";
import { HistoryFillQuiz, NameAllQuiz, QuizRun, subjectById, quizInSubject, NAME_ALL_ID, NAME_ALL_QUIZ, type FillQuiz } from '~/features/quizzes';
import { quizPageSeo, isQuizScope, isQuizSize, poolForQuiz, SCOPE_LABELS, peekWorld, type QuizScope } from '~/features/countries';
import { pageMeta } from "~/shared/lib/seo";
import type { Route } from "./+types/quizzes.$subject.$quizId";

/** /quizzes/geography/name-all/:scope/all — the free-recall quiz (features/quizzes/name-all/NameAllQuiz.tsx). */
function isNameAll(params: { subject?: string; quizId?: string; scope?: string; size?: string }): boolean {
  return (
    params.subject === "geography" &&
    params.quizId === NAME_ALL_ID &&
    params.size === "all" &&
    isQuizScope(params.scope ?? "")
  );
}

/** A history "fill the list" run has no :scope — its URL is /quizzes/history/:slug/:quizId, and it
 *  is the loader's job (build time, so the timeline never ships as a separate fetch) to hand
 *  over that quiz's entries. `fill` is null for every geography run. */
type RunData = { poolSize: number; fill: FillQuiz | null };

/** Build-time only: the size of the scope's pool, which the title says ("All 46 Countries")
 *  and which only the catalogue knows; for a history run, the quiz itself. */
export function loader({ params }: Route.LoaderArgs): RunData {
  if (!params.scope) {
    return {
      poolSize: 0,
      fill: fillQuizzes().find((q) => q.slug === params.slug && q.id === params.quizId) ?? null,
    };
  }
  const scope = params.scope;
  return {
    poolSize: isQuizScope(scope)
      ? poolForQuiz(allCountries(), params.quizId ?? "", scope).length
      : 0,
    fill: null,
  };
}

/** The pool size from the in-memory catalogue when loaded, else the prerendered data. */
export async function clientLoader({
  params,
  serverLoader,
}: Route.ClientLoaderArgs): Promise<RunData> {
  const world = peekWorld();
  if (!world || !params.scope) return serverLoader();
  const scope = params.scope;
  return {
    poolSize: isQuizScope(scope)
      ? poolForQuiz(world.data.countries, params.quizId ?? "", scope).length
      : 0,
    fill: null,
  };
}

export function meta({ params, loaderData, location }: Route.MetaArgs) {
  if (!params.scope) {
    const fill = loaderData?.fill;
    return fill
      ? pageMeta({
          title: `${fill.title} — History Quiz — Zemya`,
          description: `${fill.title}: name all ${fill.entries.length} ${fill.kind === "ruler" ? "rulers" : "governments"} from their dates — a timed fill-the-list quiz.`,
          path: location.pathname,
        })
      : pageMeta({
          title: "Quiz — Zemya",
          description: "A timed quiz.",
          path: location.pathname,
          noindex: true,
        });
  }
  const subject = params.subject ? subjectById(params.subject) : undefined;
  if (isNameAll(params)) {
    const scope = params.scope as QuizScope;
    const label = SCOPE_LABELS[scope];
    const count = loaderData?.poolSize ?? 0;
    return pageMeta({
      title: `${label} ${NAME_ALL_QUIZ.seoName} Quiz — All ${count} Countries | Zemya`,
      description:
        `${label} name-all quiz: type every one of the ${count} ${scope === "world" ? "" : `${label} `}countries you can, in any order, ` +
        `English or Bulgarian. The run is timed. No sign-up.`,
      path: location.pathname,
    });
  }
  const definition =
    subject && params.quizId
      ? quizInSubject(subject, params.quizId)
      : undefined;
  const { scope = "", size = "" } = params;
  if (!definition || !isQuizScope(scope) || !isQuizSize(size)) {
    return pageMeta({
      title: "Quiz — Zemya",
      description: "A timed quiz.",
      path: location.pathname,
      noindex: true,
    });
  }
  return pageMeta({
    ...quizPageSeo(
      definition,
      scope,
      size,
      loaderData?.poolSize ?? 0,
      new URLSearchParams(location.search).get("order") === "population"
        ? "population"
        : "random",
    ),
    path: location.pathname,
  });
}

/** One file, two kinds of run: a geography run carries :scope/:size, a history "fill the
 *  list" run (routes.ts) has neither. Dispatching here keeps QuizRun's hooks unconditional. */
export default function QuizRoute({ loaderData }: Route.ComponentProps) {
  const params = useParams<{ subject?: string; quizId?: string; scope?: string; size?: string }>();
  // "Name all countries" is a geography quiz that isn't a QuizDefinition (no engine): its own screen
  if (isNameAll(params)) {
    const scope = params.scope as QuizScope;
    return <NameAllQuiz key={scope} scope={scope} backTo="/quizzes/geography" />;
  }
  if (params.scope) return <QuizRun />;
  if (loaderData.fill) {
    return <HistoryFillQuiz key={loaderData.fill.id} quiz={loaderData.fill} backTo={`/quizzes/history/${loaderData.fill.slug}`} />;
  }
  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">Quiz</span>
        <h2>Not found</h2>
      </header>
      <div className="panel__body">
        <div className="empty">
          <div className="empty__icon">?</div>
          <p>There is no such History quiz.</p>
        </div>
        <Link to="/quizzes/history" className="action">
          Back to quizzes
        </Link>
      </div>
    </>
  );
}
