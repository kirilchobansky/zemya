/**
 * Constants, option/hover types and fly-to framing for HistoryTimeline (timeline.ts).
 */
import { decimalYearOfDate } from './scale';
import type { Axis, TimelineEntry } from './renderer';

/** Today as an exact decimal year (year + month + day, via scale.ts's decimalYearOfDate)
 *  — computed fresh in the browser, never at build time (catalog.server.ts must stay
 *  ignorant of "now" or it would freeze at the last deploy). `Date` is safe here
 *  specifically because it's read for "today"/camera framing, never used to parse an
 *  authored (possibly Julian, pre-1916) date — see the module header. */
export function todayDecimalYear(): number {
  const now = new Date();
  return decimalYearOfDate({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

/** Fly-to framing per entry kind (routes/history/history.$slug.tsx's outline list —
 *  HistoryOutline.tsx — is the only caller): a period/ruler row fits its own span plus a 5%
 *  margin on each side (a ruler's span is floored to 5 years first, "minimum 5 years wide"
 *  — a judgement call on top of the brief's unspecified exact margin, applying the same 5%
 *  period uses); an event row centres on its own date with a fixed ~10 year span around it.
 *  An open-ended span (Република България has no `end`) frames against today, same as the
 *  canvas itself clips it (HistoryTimeline.clipEntriesToToday). */
const PERIOD_FLY_MARGIN = 0.05;
const EVENT_FLY_SPAN_YEARS = 10;
const RULER_FLY_MIN_SPAN_YEARS = 5;

export function flyTargetFor(entry: Pick<TimelineEntry, 'kind' | 'start' | 'end'>, sizePx: number): { centre: number; pxPerYear: number } {
  if (entry.kind === 'event') {
    return { centre: entry.start, pxPerYear: sizePx / EVENT_FLY_SPAN_YEARS };
  }
  const end = entry.end ?? todayDecimalYear();
  const rawSpan = Math.max(end - entry.start, 0);
  const span = entry.kind === 'ruler' ? Math.max(rawSpan, RULER_FLY_MIN_SPAN_YEARS) : rawSpan;
  const displaySpan = Math.max(span * (1 + 2 * PERIOD_FLY_MARGIN), 1);
  return { centre: (entry.start + end) / 2, pxPerYear: sizePx / displaySpan };
}

export interface HistoryHover {
  entry: TimelineEntry;
  /** The hovered region's own rect, in the same canvas CSS-pixel space as PointerEvent's
   *  offsetX/offsetY — what atlas.tsx positions the floating HistoryCard beside. */
  rect: { x: number; y: number; w: number; h: number };
}

export const WHEEL_SENSITIVITY = 0.004;
export const WHEEL_LINE_SENSITIVITY = 0.05;
export const DRAG_THRESHOLD_PX = 3;
/** A pointerdown/pointerup pair counts as a click (pins the entry under it) when they're
 *  within this many CSS px of each other — "a click means pointerup with less than 4px of
 *  movement, so drags still pan the timeline" (touch has no hover, so a tap pins the same
 *  way). */
export const CLICK_MOVE_THRESHOLD_PX = 4;
/** flyTo's own animation length — "animating over 500ms with ease-in-out." */
export const FLY_DURATION_MS = 500;
/** How long the arrival pulse (renderer.ts's pulseId/pulseElapsedMs) stays on screen —
 *  "a pulsing white outline... for 1.5 seconds after arriving." */
export const PULSE_DURATION_MS = 1500;
/** onPeriodChange's own throttle — "at most 5 updates per second." */
export const PERIOD_CHANGE_THROTTLE_MS = 200;

export interface TimelineOptions {
  axis: Axis;
  entries: TimelineEntry[];
  /** Decimal year to open centred on. Omit both this and initialPxPerYear (the normal
   *  case) to open fitted to the whole dataset instead — see fitToWholeHistory. */
  initialCenter?: number;
  initialPxPerYear?: number;
  /** Fade-zone texts (countries.ts's pastLabel/futureLabel), see renderer.ts. */
  pastLabel: string;
  futureLabel: string;
  /** Called with the hovered entry + its on-screen rect, or null when nothing (or
   *  something un-hoverable) is under the pointer — see the module header on hover. */
  onHover?: (hover: HistoryHover | null) => void;
  /** Called with the clicked/tapped entry + its on-screen rect (same shape as onHover) when
   *  a click (pointerdown/pointerup within CLICK_MOVE_THRESHOLD_PX) lands on a hoverable
   *  region — pins its card (see atlas.tsx). Never fires for a drag or a pinch. */
  onEntryClick?: (hit: HistoryHover) => void;
  /** Called with the id of the period (scale.ts's `contextAt`, evaluated at the viewport's
   *  own centre date) currently "under" the centre marker — the outline list's (routes/
   *  history.$slug.tsx's HistoryOutline.tsx) "you are here" section, throttled to at
   *  most 5 calls/second (see reportPeriod) so a fast pan doesn't flood React state. */
  onPeriodChange?: (periodId: string | null) => void;
}

export const DEFAULT_CENTER = 2000;
export const DEFAULT_PX_PER_YEAR = 6;
