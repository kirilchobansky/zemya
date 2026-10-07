/**
 * Shared types of the history canvas renderer (renderer.ts and the draw-*.ts modules).
 */
import { type LayoutEntry } from './layout';
import { type EntryKind, type TimeRange, type Viewport } from './scale';

export type Axis = 'horizontal' | 'vertical';

/** A layout entry plus the one extra thing rendering needs that pure logic doesn't
 *  carry: display text. Kept separate from LayoutEntry on purpose — scale.ts/layout.ts
 *  stay ignorant of names, same as they're ignorant of YAML or JSON. The country's language (name[lang]),
 *  not English — see catalog.server.ts. */
export interface TimelineEntry extends LayoutEntry {
  label: string;
  /** Rulers and governments only (null for period/event) — drawn as a second, smaller
   *  line beneath the name in the capsule (see drawWireCapsules). */
  role: string | null;
  /** Summary in the country's language (blurb[lang]), one or two sentences — the hover card's body text. */
  blurb: string;
  /** Events only (null otherwise) — a key from content/history/events-bg.json's
   *  categories[], e.g. "war", "treaty" — the hover card's coloured dot + English label. */
  category: string | null;
  /** "#rrggbb" or null — period band / event category colour, authored in content/
   *  history/*.yaml. Used by the hover card's category dot. */
  color: string | null;
  precision: 'exact' | 'year' | 'circa' | 'disputed';
  /** Free-text keywords authored alongside the entry (mostly events) — shown in the
   *  pinned card's "See more" detail panel (routes/history/history.$slug.tsx), nowhere else. */
  tags: readonly string[];
  /** Alternate spellings (Cyrillic and Latin), authored in content/history/bg.yaml —
   *  read only by app/features/history/data/search.ts, never displayed. */
  aliases: readonly string[];
  /** "old" (Julian) before 1 April 1916, "new" (Gregorian) on/after — the detail view's
   *  "Old style (Julian calendar)" note (app/features/history/components/HistoryDetail.tsx). Not used by
   *  rendering itself, only by that note. */
  style: 'old' | 'new';
}

/** One hoverable region recorded by render(), in real canvas CSS-pixel coordinates
 *  (the same space as PointerEvent's offsetX/offsetY) — axis-agnostic, since project()/
 *  rectFor() have already resolved along/cross into real x/y/w/h by the time a region is
 *  recorded. Consumed by app/features/history/timeline/timeline.ts's hit-testing; drawn by nothing
 *  itself. */
export interface HitRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Copied off the entry, so timeline.ts's tie-break ("ties go to the lower tier
   *  number") doesn't need a second lookup. */
  tier: number;
}

/* ------------------------------------------------------------------------------- wires */

export interface WireLayout {
  top: number;
  height: number;
  rowHeight: number;
  subRows: number;
}

/* ------------------------------------------------------------------------- connector lines */

/** What a pinned card (app/features/history/components/HistoryCard.tsx's PinnedHistoryCard, tracked by
 *  atlas.tsx) needs handed in for its connector line — its own entry's date span (to
 *  locate the target on the timeline) and its current on-screen DOM rect, in the same
 *  canvas CSS-pixel space as HitRegion. Resolved by timeline.ts from its own full,
 *  unfiltered entry list, so a pinned entry currently hidden by a filter (HistoryFilters.tsx)
 *  still has somewhere real to point to. */
export interface PinnedCardTarget {
  id: string;
  kind: EntryKind;
  start: number;
  end: number | null;
  rect: { x: number; y: number; w: number; h: number };
}

/* -------------------------------------------------------------------------------- entry point */

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  viewport: Viewport;
  axis: Axis;
  /** The canvas's extent perpendicular to the timeline — height when horizontal, width
   *  when vertical. Not part of Viewport, which is deliberately just the time axis. */
  crossSizePx: number;
  /** Strips of the cross axis that something else covers (a phone's top HUD, the bottom sheet
   *  and tab bar). The cylinder is centred in what is left, never under them. 0 on desktop. */
  crossInsets: { start: number; end: number };
  dpr: number;
  uiFont: string;
  monoFont: string;
  /** [earliest authored entry, today] — draws the out-of-range fade/labels. */
  contentRange: TimeRange;
  /** Text of the fade zones before the earliest entry and after today. */
  pastLabel: string;
  futureLabel: string;
  /** The id of the entry timeline.ts's hit-testing currently has under the pointer, or
   *  null — the one capsule/pin drawn brighter + outlined (see drawWireCapsules/
   *  drawEventPins). Never the period colour wash, which isn't hoverable. */
  hoveredId: string | null;
  /** Ids of every entry with an open pinned card (atlas.tsx) — each gets a persistent
   *  1.5px white outline (see drawWireCapsules/drawEventPins) so it's clear which entry a
   *  floating card belongs to, independent of hover. */
  pinnedIds: ReadonlySet<string>;
  /** The entry HistoryOutline.tsx's fly-to just landed on, or null — reuses the hover
   *  outline style (see drawWireCapsules/drawEventPins) but pulses its opacity via
   *  `pulseElapsedMs` for PULSE_DURATION_MS after arriving (timeline.ts's updatePulse). */
  pulseId: string | null;
  /** Milliseconds since the pulse started (0 while none is active) — the pulse's own sine
   *  phase, not a 0..1 progress fraction (it has no fixed endpoint from the renderer's
   *  point of view; timeline.ts clears pulseId once its own duration elapses). */
  pulseElapsedMs: number;
  /** Every pinned card's own date span + current DOM rect — draws a connector line from
   *  each to its entry's position on the timeline (see drawConnectorLines). Empty outside
   *  the history route or while nothing is pinned. */
  pinnedCards: readonly PinnedCardTarget[];
}
