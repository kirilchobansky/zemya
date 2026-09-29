/**
 * The atlas layout's own context (routes/atlas.tsx's `AtlasShell`) — split into its own
 * module so the route file exports only the layout component and route API (React Router's
 * framework mode treats a route module's other exports as meaningful — `loader`, `meta`,
 * etc. — so a plain context/hook pair living there too was never quite at home). Read by
 * every child route rendered into the atlas's right-hand panel or reached from a click on
 * its canvas — the quiz runs, the history panel, HistoryFilters.tsx — never imported by
 * `app/lib/map/` or `app/lib/geography/` (CLAUDE.md: `app/lib/map/` stays React-free).
 */
import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';

import type { Atlas } from '~/lib/map/atlas';
import type { HistoryTimeline } from '~/lib/history/timeline';
import type { TimelineEntry } from '~/lib/history/renderer';
import type { EntryKind } from '~/lib/history/scale';
import type { SheetSnap } from '~/lib/sheet';
import type { QuizOverride } from '~/lib/geography/overlays';

/**
 * The layout owns the canvas, so a quiz run — a child route rendered only into the right
 * panel — reaches the Atlas controller (to fly the camera) and the map's style (to paint
 * answered countries) through this context rather than through props. `quiz` is the
 * single flag CLAUDE.md's Quizzes section asks for: setting it swaps the map into quiz
 * mode (see routes/atlas.tsx's style effect) and, at that file's JSX call sites, hides the
 * search box and the hover tooltip and turns off the default neighbour glow — one state,
 * checked in the few places that need it, rather than four independent booleans.
 */
export interface TimelineLabels {
  pastLabel: string;
  futureLabel: string;
}

export interface AtlasContextValue {
  atlas: Atlas | null;
  quiz: QuizOverride | null;
  setQuiz: Dispatch<SetStateAction<QuizOverride | null>>;
  /** Phone layout only (no effect on desktop): a quiz run takes the whole screen — no sheet,
   *  no tab bar, no search — until its results, which open the sheet at `full`. */
  setImmersive: Dispatch<SetStateAction<boolean>>;
  setSheetSnap: Dispatch<SetStateAction<SheetSnap>>;
  /** Set by a history route (routes/history.$slug.tsx) once its loader data is in hand;
   *  cleared on unmount. Non-null swaps the canvas from the map to the timeline — see
   *  routes/atlas.tsx's effect that owns the HistoryTimeline controller. */
  setTimelineEntries: Dispatch<SetStateAction<TimelineEntry[] | null>>;
  /** Fade-zone texts of the country being shown; set alongside setTimelineEntries. */
  setTimelineLabels: Dispatch<SetStateAction<TimelineLabels>>;
  /** Ids of every entry currently pinned (click-to-pin on the timeline canvas), in pin
   *  order — read by routes/history.$slug.tsx for its "Close all cards (N)" button.
   *  Cleared whenever the history route is left (see routes/atlas.tsx's showTimeline
   *  effect). */
  historyPinnedIds: readonly string[];
  closeAllHistoryCards: () => void;
  /** Set by a pinned card's "See more" (components/HistoryCard.tsx) — the history route's
   *  panel switches to that entry's detail view while this is non-null. */
  selectedHistoryEntryId: string | null;
  setSelectedHistoryEntryId: Dispatch<SetStateAction<string | null>>;
  /** Pins an entry as a floating card without a canvas click (routes/history.$slug.tsx's
   *  detail view "Pin card" button) — see routes/atlas.tsx's pinHistoryEntry for how. */
  pinHistoryEntry: (entry: TimelineEntry) => void;
  /** The HistoryTimeline controller once it's mounted (routes/history.$slug.tsx's
   *  HistoryOutline.tsx calls flyTo/flyToWholeHistory/flyToToday on it directly) — null
   *  outside the history route, and briefly while it's still constructing. */
  historyTimeline: HistoryTimeline | null;
  /** timeline.ts's onPeriodChange, throttled to 5/s — the outline's "you are here"
   *  section. */
  historyCurrentPeriodId: string | null;
  /** HistoryFilters.tsx's kind toggles ("Rulers"/"Governments"/"Events") — the set of
   *  kinds currently hidden (never `period`: periods are always shown). Lives here rather
   *  than in the history route so it survives a "See more" swap to the detail view, and is
   *  reset to empty whenever the history route is left (see routes/atlas.tsx's effect). */
  historyHiddenKinds: ReadonlySet<EntryKind>;
  toggleHistoryKind: (kind: EntryKind) => void;
  /** HistoryFilters.tsx's event category chips — the set of category ids currently
   *  hidden. Same lifetime as historyHiddenKinds. */
  historyHiddenCategories: ReadonlySet<string>;
  toggleHistoryCategory: (category: string) => void;
  resetHistoryFilters: () => void;
}

export const AtlasContext = createContext<AtlasContextValue | null>(null);

export function useAtlasContext(): AtlasContextValue {
  const value = useContext(AtlasContext);
  if (!value) throw new Error('useAtlasContext must be used inside the atlas layout');
  return value;
}
