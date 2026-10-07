/**
 * The quiz list for one subject — geography's three quizzes; for History this same file
 * serves two more levels (see the default export): /quizzes/history is a list of countries
 * and /quizzes/history/:slug (a second route id, routes.ts) is that country's quizzes. Listed
 * compact (name only); clicking a name expands its scope chips, size ladder and history
 * inline, one quiz open at a time. Same markup on desktop's right panel and the phone sheet
 * (quiz-list.css handles the width difference). See CLAUDE.md's Quizzes section and
 * docs/quizzes.md's "Route shape".
 */
import { pageMeta } from "~/shared/lib/seo";
import { HistoryCountries, HistoryCountryQuizzes, QuizList, poolCounts, subjectById, type FillSummary, type ListData } from '~/features/quizzes';
import { peekWorld } from '~/features/countries';
import { allCountries } from "~/features/countries/catalog.server";
import { fillQuizzes } from "~/features/quizzes/history-fill/fill-quizzes.server";
import { historyCountryFor } from '~/features/history';
import type { Route } from "./+types/quizzes.$subject";
import '~/features/quizzes/engine/quiz-list.css';
import '~/features/quizzes/engine/quiz-list.phone.css';

const summariseFill = (): FillSummary[] =>
  fillQuizzes().map((q) => ({
    id: q.id,
    slug: q.slug,
    title: q.title,
    kind: q.kind,
    count: q.entries.length,
  }));

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
      : `Timed ${subject.name.toLowerCase()} quizzes: ${[...subject.quizzes, ...(subject.extraQuizzes ?? [])].map((q) => q.title).join(", ")}.`,
    path: `/quizzes/${subject.id}`,
  });
}

/** One file, three levels: the geography list (`/quizzes/geography`), History's country list
 *  (`/quizzes/history`) and one country's History quizzes (`/quizzes/history/:slug`, which
 *  has `:slug` and no `:subject`). Dispatching here keeps each component's hooks unconditional. */
export default function QuizzesRoute(props: Route.ComponentProps) {
  const { params, loaderData } = props;
  if (params.slug) return <HistoryCountryQuizzes slug={params.slug} fill={loaderData.fill} />;
  const subject = params.subject ? subjectById(params.subject) : undefined;
  if (subject?.fillQuizzes) return <HistoryCountries fill={loaderData.fill} />;
  return <QuizList subjectId={params.subject} scopeCounts={loaderData.scopeCounts} />;
}

