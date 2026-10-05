/**
 * The quiz catalogue: the registry of QuizDefinitions the shared engine/route (app/lib/quiz/engine.ts,
 * routes/quiz.$quizId.tsx) run. A second quiz is one entry in QUIZ_DEFINITIONS, never a
 * new route tree — see CLAUDE.md's Quizzes section.
 */
import { CapitalsStage, capitalAnswer } from "~/components/quiz/CapitalsStage";
import { CountriesStage } from "~/components/quiz/CountriesStage";
import { FlagsStage } from "~/components/quiz/FlagsStage";
import {
  CurrencyStage,
  currencyAnswer,
  LanguageStage,
  languageAnswer,
  ReligionStage,
  religionAnswer,
} from "~/components/quiz/FacetStages";
import { OutlinesStage } from "~/components/quiz/OutlinesStage";
import {
  matchesCapital,
  matchesCurrency,
  matchesLanguage,
  matchesReligion,
  normaliseName,
} from "~/lib/geography/names";
import type { QuizSize } from "~/lib/geography/scopes";
import type { MatchOutcome, QuizDefinition } from "~/lib/quiz/types";
import type { CountryRecord } from "~/lib/map/types";

export type QuizSelectionMode = "random" | "population";

/**
 * Accepts the target's confusable twin (see content/geography/confusable-flags.yaml) as
 * well as its own name — the flags quiz's one addition on top of the plain name match
 * every quiz gets for free. Returns null (fall through to the default matcher) for
 * everything else, including the target's own name; matchesCountry already handles that.
 */
function matchFlag(typed: string, target: CountryRecord): MatchOutcome | null {
  const twin = target.confusableFlag;
  if (!twin) return null;
  const normalised = normaliseName(typed);
  if (
    !normalised ||
    !twin.aliases.some((alias) => normaliseName(alias) === normalised)
  )
    return null;
  return {
    accepted: true,
    note: `Accepted — that one was ${target.name}. ${twin.note}`,
  };
}

/** Preloads the SVGs for a lookahead of targets — the heaviest flags are 200+ KB, and a
 *  hitch fetching one mid-run would feel broken in a timed quiz. The browser's own cache
 *  is all that's needed; nothing here holds onto the Image object. */
function preloadFlags(targets: CountryRecord[]): void {
  for (const country of targets) {
    const img = new Image();
    img.src = `/flags/${country.iso2.toLowerCase()}.svg`;
  }
}

export const QUIZ_DEFINITIONS: QuizDefinition[] = [
  {
    id: "countries",
    title: "Name the Country",
    description:
      "The map flies to a country. Type its name before the timer runs out of countries to ask.",
    seoName: "Map",
    seoTask: "Type the name of each country the map flies to.",
    facet: "location",
    Stage: CountriesStage,
  },
  {
    id: "flags",
    title: "Name the Flag",
    description:
      "A flag fills the screen. Type the country before the timer runs out of flags to ask.",
    seoName: "Flags",
    seoTask: "Type the country each flag belongs to.",
    facet: "flag",
    Stage: FlagsStage,
    hidesMap: true,
    prepare: preloadFlags,
    match: matchFlag,
  },
  {
    id: "outlines",
    title: "Name the Country from its Outline",
    description:
      "A silhouette fills the screen. Type the country before the timer runs out of outlines to ask.",
    seoName: "Outlines",
    seoTask: "Type the country each outline belongs to.",
    facet: "outline",
    Stage: OutlinesStage,
    hidesMap: true,
  },
  {
    id: "capitals",
    title: "Name the Capital",
    description:
      "A country lights up and its capital gets a marker. Type the city before the timer runs out of capitals to ask.",
    seoName: "Capitals",
    seoTask: "Type the capital of each highlighted country.",
    facet: "capital",
    Stage: CapitalsStage,
    answerOf: capitalAnswer,
    markCapital: true,
    // Always returns an outcome — never null — so the engine's fallback to the plain
    // COUNTRY-name match never runs: typing "France" must not answer "capital of France".
    match: (typed, target) => ({ accepted: matchesCapital(typed, target) }),
  },
  // The three facet quizzes below share the capitals quiz's screen and its "always return an
  // outcome" rule (naming the country must not score). Their answers are NOT unique — many
  // countries share "Euro" or "Spanish" — which is fine because the question is always
  // country -> value; there is no value -> country. Pools exclude a missing or disputed
  // facet: scopes.ts's QUIZ_POOL_FILTERS.
  {
    id: "currency",
    title: "Name the Currency",
    description:
      "A country lights up. Type its currency — the full name or the ISO code — before the timer runs out of countries to ask.",
    seoName: "Currencies",
    seoTask: "Type the currency of each highlighted country.",
    facet: "currency",
    Stage: CurrencyStage,
    answerOf: currencyAnswer,
    match: (typed, target) => ({ accepted: matchesCurrency(typed, target) }),
  },
  {
    id: "language",
    title: "Name the Language",
    description:
      "A country lights up. Type any of its official languages before the timer runs out of countries to ask.",
    seoName: "Languages",
    seoTask: "Type an official language of each highlighted country.",
    facet: "language",
    Stage: LanguageStage,
    answerOf: languageAnswer,
    match: (typed, target) => ({ accepted: matchesLanguage(typed, target) }),
  },
  {
    id: "religion",
    title: "Name the Religion",
    description:
      "A country lights up. Type its predominant religion — as specifically as the country's own — before the timer runs out of countries to ask.",
    seoName: "Religions",
    seoTask: "Type the predominant religion of each highlighted country.",
    facet: "religion",
    Stage: ReligionStage,
    answerOf: religionAnswer,
    match: (typed, target) => ({ accepted: matchesReligion(typed, target) }),
  },
];

export function quizDefinition(id: string): QuizDefinition | undefined {
  return QUIZ_DEFINITIONS.find((q) => q.id === id);
}

/** Selects a fresh random subset for a numeric quiz size. The full pool remains available
 *  for All, while each Top-N run gets a different mix of countries. */
export function randomSubset(
  countries: CountryRecord[],
  size: QuizSize,
): CountryRecord[] {
  if (size === "all") return [...countries];

  const shuffled = [...countries];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled.slice(0, Number(size));
}

export function populationSubset(
  countries: CountryRecord[],
  size: QuizSize,
): CountryRecord[] {
  const sorted = [...countries].sort((a, b) => b.population - a.population);
  return size === "all" ? sorted : sorted.slice(0, Number(size));
}

export function selectQuizCountries(
  countries: CountryRecord[],
  size: QuizSize,
  mode: QuizSelectionMode,
): CountryRecord[] {
  return mode === "population"
    ? populationSubset(countries, size)
    : randomSubset(countries, size);
}
