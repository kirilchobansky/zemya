/**
 * Event pins and period bands.
 */
import {
  type Axis,
  type TimelineEntry,
  type HitRegion,
  type WireLayout,
} from "./render-types";
import {
  shade,
  COLORS,
  PERIOD_BAND_COLORS,
  RENDER_CONFIG,
} from "./render-colors";
import { edgeFade } from "./render-easing";
import {
  eventTierReveal,
  project,
  rectFor,
  drawHaloText,
  labelCandidate,
} from "./render-geometry";
import { classifySpan, placeLabels } from "./layout";
import {
  dateOfDecimalYear,
  timeToPx,
  type Viewport,
  type ZoomLevel,
} from "./scale";

/** `3.03.1878` — day (no leading zero), zero-padded month, full year; year-only (no dot)
 *  when the month itself is unknown. Distinct from formatHistoryDate (the centre-date
 *  readout's "3 March 1878" style) — this is the event pin's compact sub-line. */
function formatEventDateLine(d: {
  year: number;
  month: number | null;
  day: number | null;
}): string {
  const yearLabel = d.year < 0 ? `${-d.year} BC` : String(d.year);
  if (d.month == null) return yearLabel;
  return `${d.day}.${String(d.month).padStart(2, "0")}.${yearLabel}`;
}

/**
 * Events as pins: a 1px vertical line at exactly `timeToPx(e.start)`, hanging from the top of
 * the event wire to a height set by tier (RENDER_CONFIG.pinHeightFracByTier), a small dot at its
 * bottom end and the name to the dot's right (an exact-date line under it at month zoom and
 * finer). A pin below its tier's reveal threshold at this zoom (eventTierReveal) is skipped;
 * the rest draw at `reveal` opacity, fading in across their zoom band and out at the screen's
 * edges.
 *
 * The line and the dot are static: one width, one radius, one colour, whatever the pointer,
 * the centre marker, a pinned card or an arrival does (the params for those stay in the
 * signature, unused, because the renderer still passes them to the wire capsules).
 *
 * A name always travels with its line, to the line's right. When the line has gone off the left
 * edge the name keeps drawing (moving with it) until the text itself is off screen.
 */
/** Half-width of an event pin's hit region — the 1px pin gets 6px of tolerance on each
 *  side, per the hover brief. */
const PIN_HIT_HALF_WIDTH_PX = 6;

/** Zoom (px per year) from which every event name shows, colliding or not: about halfway (in log
 *  terms) between the year level (8) and the month level (96). */
export const SHOW_ALL_NAMES_PX_PER_YEAR = 1000;
/** The renderer feeds pins from this far out (visibleRangeOverscan factor), so a name whose
 *  line is just off the left edge still has its pin in the list. */
export const LABEL_POOL_OVERSCAN = 3;

export function drawEventPins(
  ctx: CanvasRenderingContext2D,
  axis: Axis,
  uiFont: string,
  monoFont: string,
  entries: readonly TimelineEntry[],
  viewport: Viewport,
  wire: WireLayout,
  level: ZoomLevel,
  _activeAmounts: ReadonlyMap<string, number>,
  _hoveredId: string | null,
  _pinnedIds: ReadonlySet<string>,
  _pulseId: string | null,
  _pulseElapsedMs: number,
  hits: HitRegion[],
): void {
  const fontPx = RENDER_CONFIG.pinLabelFontPxByLevel[level];
  const dateFontPx = Math.round(fontPx * 0.7);
  const showDate = level === "month" || level === "day";
  const lineGap = 2;
  const gap = RENDER_CONFIG.pinLabelGapPx;
  const dotRadius = RENDER_CONFIG.pinDotRadiusPx;
  const size = viewport.sizePx;

  ctx.font = `600 ${fontPx}px ${uiFont}`;
  const pins = entries
    .map((e) => {
      const px = timeToPx(e.start, viewport);
      const tierReveal = eventTierReveal(e.tier, viewport.pxPerYear);
      const width = ctx.measureText(e.label).width;
      return {
        e,
        px,
        width,
        tierReveal,
        reveal: tierReveal * edgeFade(px, size, RENDER_CONFIG.edgeMarginPx),
      };
    })
    // a pin counts while its line is on screen, or while its name still is
    .filter(
      ({ px, reveal, tierReveal, width }) =>
        px <= size &&
        tierReveal > 0.02 &&
        (px >= 0 ? reveal > 0.02 : px + gap + width > 0),
    );

  // Names are collision-resolved by tier, except once zoomed in past SHOW_ALL_NAMES_PX_PER_YEAR,
  // where every name shows (the tiers hang at different heights, so most still read).
  const placed =
    viewport.pxPerYear >= SHOW_ALL_NAMES_PX_PER_YEAR
      ? new Set(pins.map(({ e }) => e.id))
      : new Set(
          placeLabels(
            pins.map(({ e, px, width }) =>
              labelCandidate(e.id, px + gap, width, "left", e.tier),
            ),
          ).map((c) => c.id),
        );

  for (const { e, px, tierReveal, reveal } of pins) {
    const frac =
      RENDER_CONFIG.pinHeightFracByTier[e.tier] ??
      RENDER_CONFIG.pinHeightFracByTier[3];
    const bottom = wire.top + wire.height * frac;
    // Brightened toward white so a category's own (often dim) authored colour still reads
    // against the dark background — HistoryFilters.tsx's chips show the same colour
    // unbrightened, close enough in hue to double as this pin's legend.
    const pinColor = e.color ? shade(e.color, -0.35) : COLORS.event;

    ctx.save();

    if (px >= 0 && reveal > 0.02) {
      const hitRect = rectFor(
        axis,
        px - PIN_HIT_HALF_WIDTH_PX,
        px + PIN_HIT_HALF_WIDTH_PX,
        wire.top,
        bottom,
      );
      hits.push({
        id: e.id,
        x: hitRect.x,
        y: hitRect.y,
        w: hitRect.w,
        h: hitRect.h,
        tier: e.tier,
      });

      ctx.globalAlpha = reveal;
      ctx.strokeStyle = pinColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const p0 = project(axis, px, wire.top);
      const p1 = project(axis, px, bottom);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();

      ctx.fillStyle = pinColor;
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    if (placed.has(e.id)) {
      // the name fades out only at the right edge, with its pin; never at the left
      ctx.globalAlpha =
        px > size - RENDER_CONFIG.edgeMarginPx ? reveal : tierReveal;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const nameCross = showDate ? bottom - (dateFontPx + lineGap) / 2 : bottom;

      ctx.font = `600 ${fontPx}px ${uiFont}`;
      drawHaloText(ctx, axis, px + gap, nameCross, e.label, COLORS.white);

      if (showDate) {
        const dateCross = bottom + (fontPx + lineGap) / 2;
        ctx.font = `500 ${dateFontPx}px ${monoFont}`;
        drawHaloText(
          ctx,
          axis,
          px + gap,
          dateCross,
          formatEventDateLine(dateOfDecimalYear(e.start)),
          COLORS.whiteDim,
        );
      }
    }
    ctx.restore();
  }
}

/**
 * A wide translucent band per visible period, behind everything else inside the cylinder
 * — "the era is felt as background colour." Coloured by the period's stable index in the
 * WHOLE dataset (`periodIndexOf`, computed once in render() from every period, not just
 * the visible ones), so a given era's wash never changes colour as it scrolls in and out
 * of view.
 */
export function drawPeriodBands(
  ctx: CanvasRenderingContext2D,
  axis: Axis,
  periods: readonly TimelineEntry[],
  periodIndexOf: ReadonlyMap<string, number>,
  viewport: Viewport,
  top: number,
  bottom: number,
): void {
  for (const e of periods) {
    const span = classifySpan(e, viewport);
    const fromPx = span.mode === "bar" ? span.fromPx : 0;
    const toPx = span.mode === "bar" ? span.toPx : viewport.sizePx;
    if (toPx - fromPx < 1) continue;
    const colorIndex =
      (periodIndexOf.get(e.id) ?? 0) % PERIOD_BAND_COLORS.length;
    ctx.fillStyle = PERIOD_BAND_COLORS[colorIndex];
    const r = rectFor(axis, fromPx, toPx, top, bottom);
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
}
