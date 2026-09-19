/**
 * The quiz catalogue: the registry of QuizDefinitions the shared engine/route (app/lib/quiz/engine.ts,
 * routes/quiz.$quizId.tsx) run. A second quiz is one entry in QUIZ_DEFINITIONS, never a
 * new route tree — see CLAUDE.md's Quizzes section.
 */
import { CapitalsStage } from '~/components/quiz/CapitalsStage';
import { CountriesStage } from '~/components/quiz/CountriesStage';
import { FlagsStage } from '~/components/quiz/FlagsStage';
import { matchesCapital, normaliseName } from '~/lib/geography/names';
import type { QuizSize } from '~/lib/geography/scopes';
import type { MatchOutcome, QuizDefinition } from '~/lib/quiz/types';
import type { CountryRecord } from '~/lib/map/types';

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
  if (!normalised || !twin.aliases.some(alias => normaliseName(alias) === normalised)) return null;
  return { accepted: true, note: `Accepted — that one was ${target.name}. ${twin.note}` };
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
    id: 'countries',
    title: 'Name the Country',
    description: 'The map flies to a country. Type its name before the timer runs out of countries to ask.',
    facet: 'location',
    Stage: CountriesStage
  },
  {
    id: 'flags',
    title: 'Name the Flag',
    description: 'A flag fills the screen. Type the country before the timer runs out of flags to ask.',
    facet: 'flag',
    Stage: FlagsStage,
    prepare: preloadFlags,
    match: matchFlag
  },
  {
    id: 'capitals',
    title: 'Name the Capital',
    description: 'A country lights up and its capital gets a marker. Type the city before the timer runs out of capitals to ask.',
    facet: 'capital',
    Stage: CapitalsStage,
    markCapital: true,
    // Always returns an outcome — never null — so the engine's fallback to the plain
    // COUNTRY-name match never runs: typing "France" must not answer "capital of France".
    match: (typed, target) => ({ accepted: matchesCapital(typed, target) })
  }
];

export function quizDefinition(id: string): QuizDefinition | undefined {
  return QUIZ_DEFINITIONS.find(q => q.id === id);
}

/** The N most populous countries of the pool passed in (a whole scope, see scopes.ts) —
 *  the axis the quizzes rank by. Kept behind one
 *  function so ranking by a different axis (area, alphabetical, ...) for a future quiz is
 *  a one-line change here, not a rewrite of the run screen. */
export function topByPopulation(countries: CountryRecord[], size: QuizSize): CountryRecord[] {
  const sorted = [...countries].sort((a, b) => b.population - a.population);
  return size === 'all' ? sorted : sorted.slice(0, Number(size));
}
