/**
 * Countries with a history timeline — what the History nav section lists. Plain data (no
 * Node APIs), unlike catalog.server.ts, so it's safe to import from a route component as
 * well as a loader. One entry today: see CLAUDE.md's history exception before adding more.
 */
export interface HistoryCountry {
  slug: string;
  /** Bulgarian, not English — see catalog.server.ts's own note on why. */
  name: string;
  /** The timeline's covered span, as shown next to the name in the picker. */
  range: string;
}

export const HISTORY_COUNTRIES: HistoryCountry[] = [
  { slug: 'bulgaria', name: 'България', range: '681–днес' }
];
