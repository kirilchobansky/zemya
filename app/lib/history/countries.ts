/**
 * Countries with a history timeline — what the History nav section lists. Plain data (no
 * Node APIs), unlike catalog.server.ts, so it's safe to import from a route component as
 * well as a loader. Adding a country is one line here plus its content/history/<file>.yaml
 * (CLAUDE.md, "How to add a history country") — no other code changes.
 */
export interface HistoryCountry {
  slug: string;
  /** Base name of the country's data: content/history/<file>.yaml -> public/data/history/<file>.json. */
  file: string;
  /** Bulgarian, not English — see catalog.server.ts's own note on why. */
  name: string;
  /** English name and adjective, for the panel header, page title and description. */
  nameEn: string;
  adjectiveEn: string;
  /** The first year shown in the panel header's "<startYear> – today" line. */
  startYear: string;
  /** The timeline's covered span, as shown next to the name in the picker. */
  range: string;
  /** Text for the fade zone before the earliest entry, after "Before <year> — ". */
  pastLabel: string;
  /** Text for the fade zone after today. */
  futureLabel: string;
}

export const HISTORY_COUNTRIES: HistoryCountry[] = [
  {
    slug: 'bulgaria', file: 'bg', name: 'България', nameEn: 'Bulgaria', adjectiveEn: 'Bulgarian',
    startYear: '681', range: '681–днес', pastLabel: 'Old Great Bulgaria', futureLabel: 'Future'
  }
];

export function historyCountryFor(slug: string): HistoryCountry | undefined {
  return HISTORY_COUNTRIES.find(c => c.slug === slug);
}
