/**
 * Event pins and period bands.
 */
import { type Axis, type TimelineEntry, type HitRegion, type WireLayout } from './render-types';
import { shade, COLORS, PERIOD_BAND_COLORS, RENDER_CONFIG } from './render-colors';
import { edgeFade, clampToMargin, activeAmounts, pulseAlpha } from './render-easing';
import { eventTierReveal, project, rectFor, drawHaloText, labelCandidate } from './render-geometry';
import { classifySpan, placeLabels, type LabelCandidate } from './layout';
import { dateOfDecimalYear, timeToPx, type Viewport, type ZoomLevel } from './scale';

/** `3.03.1878` — day (no leading zero), zero-padded month, full year; year-only (no dot)
 *  when the month itself is unknown. Distinct from formatHistoryDate (the centre-date
 *  readout's "3 March 1878" style) — this is the event pin's compact sub-line. */
function formatEventDateLine(d: { year: number; month: number | null; day: number | null }): string {
  const yearLabel = d.year < 0 ? `${-d.year} BC` : String(d.year);
  if (d.month == null) return yearLabel;
  return `${d.day}.${String(d.month).padStart(2, '0')}.${yearLabel}`;
}

/**
 * Events as pins, not capsules: a 1px vertical line at exactly `timeToPx(e.start)`,
 * hanging from the fixed top of the event wire (never per-row — a pin's position IS the
 * exact time, so there's nothing to row-pack), with a small dot at its bottom end. Pin
 * height is a fraction of the wire's own full height, by tier (RENDER_CONFIG.
 * pinHeightFracByTier) — the loudest (tier 1) events reach the full wire height, quieter
 * ones stop short. A pin below its own tier's reveal threshold at the current zoom
 * (eventTierReveal) is skipped outright; everything else draws at `reveal` opacity, so a
 * tier fades in across its own zoom band rather than popping in at a hard cutoff. The
 * label sits to the right of the dot, name above an optional smaller exact-date line
 * (month zoom and finer only); candidates are collision-resolved through placeLabels so a
 * crowded moment keeps its most important pins' labels and silently drops the rest (the
 * pin and dot still draw regardless — only the TEXT is dropped). Pins close to the centre
 * (`activeAmounts`, same id→amount map drawWireCapsules uses — see render()'s activeIds)
 * get a thicker line and a slightly bigger dot, eased over ~120ms; the label itself never
 * changes size.
 */
/** Half-width of an event pin's hit region — the 1px pin gets 6px of tolerance on each
 *  side, per the hover brief. */
const PIN_HIT_HALF_WIDTH_PX = 6;

/** How close (in px) an event pin's exact date must sit to the centre marker to count as
 *  "active" (see render()'s activeIds) — a judgement call standing in for the brief's own
 *  unspecified exact radius. */
export const PIN_ACTIVE_RADIUS_PX = 30;

export function drawEventPins(
  ctx: CanvasRenderingContext2D, axis: Axis, uiFont: string, monoFont: string,
  entries: readonly TimelineEntry[], viewport: Viewport, wire: WireLayout, level: ZoomLevel,
  activeAmounts: ReadonlyMap<string, number>,
  hoveredId: string | null, pinnedIds: ReadonlySet<string>, pulseId: string | null, pulseElapsedMs: number,
  hits: HitRegion[]
): void {
  const fontPx = RENDER_CONFIG.pinLabelFontPxByLevel[level];
  const dateFontPx = Math.round(fontPx * 0.7);
  const showDate = level === 'month' || level === 'day';
  const lineGap = 2;
  const gap = RENDER_CONFIG.pinLabelGapPx;
  const dotRadius = RENDER_CONFIG.pinDotRadiusPx;

  // Tier filtering (CONFIG.maxTier's `event` column, via eventTierReveal) happens HERE,
  // not upstream in the entry list — a pin below its own reveal threshold is skipped
  // entirely (pin, dot AND label), everything else fades in smoothly rather than popping.
  // `px` is already clamped into the edge margin (RENDER_CONFIG.edgeMarginPx) — the pin,
  // dot and label all draw at this held position; `reveal` folds in edgeFade's own
  // proximity-to-edge fade, computed from the TRUE (unclamped) position, so a pin still
  // fades out as it nears the edge even though its drawn position stops moving.
  const margin = RENDER_CONFIG.edgeMarginPx;
  const onScreen = entries
    .map(e => {
      const rawPx = timeToPx(e.start, viewport);
      const reveal = eventTierReveal(e.tier, viewport.pxPerYear) * edgeFade(rawPx, viewport.sizePx, margin);
      return { e, rawPx, px: clampToMargin(rawPx, viewport.sizePx, margin), reveal };
    })
    .filter(({ rawPx, reveal }) => rawPx >= 0 && rawPx <= viewport.sizePx && reveal > 0.02);

  ctx.font = `600 ${fontPx}px ${uiFont}`;
  const candidates: LabelCandidate[] = onScreen.map(({ e, px }) =>
    labelCandidate(e.id, px + gap, ctx.measureText(e.label).width, 'left', e.tier)
  );
  const placed = new Set(placeLabels(candidates).map(c => c.id));

  for (const { e, px, reveal } of onScreen) {
    const frac = RENDER_CONFIG.pinHeightFracByTier[e.tier] ?? RENDER_CONFIG.pinHeightFracByTier[3];
    const bottom = wire.top + wire.height * frac;
    const isHovered = e.id === hoveredId;
    const amt = activeAmounts.get(e.id) ?? 0;
    const hitRect = rectFor(axis, px - PIN_HIT_HALF_WIDTH_PX, px + PIN_HIT_HALF_WIDTH_PX, wire.top, bottom);
    hits.push({ id: e.id, x: hitRect.x, y: hitRect.y, w: hitRect.w, h: hitRect.h, tier: e.tier });
    // Brightened toward white so a category's own (often dim) authored colour still reads
    // against the dark background — HistoryFilters.tsx's chips show the same colour
    // unbrightened, close enough in hue to double as this pin's legend.
    const pinColor = e.color ? shade(e.color, -0.35) : COLORS.event;

    ctx.save();
    ctx.globalAlpha = reveal;

    ctx.strokeStyle = pinColor;
    ctx.lineWidth = Math.max(isHovered ? 2 : 1, 1 + amt);
    ctx.beginPath();
    const p0 = project(axis, px, wire.top);
    const p1 = project(axis, px, bottom);
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();

    const dot = project(axis, px, bottom);
    ctx.beginPath();
    ctx.fillStyle = pinColor;
    ctx.arc(dot.x, dot.y, dotRadius * Math.max(isHovered ? 1.6 : 1, 1 + amt * 0.4), 0, Math.PI * 2);
    ctx.fill();

    if (pinnedIds.has(e.id)) {
      ctx.beginPath();
      ctx.strokeStyle = COLORS.white;
      ctx.lineWidth = 1.5;
      ctx.arc(dot.x, dot.y, dotRadius + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (e.id === pulseId) {
      ctx.beginPath();
      ctx.strokeStyle = COLORS.white;
      ctx.globalAlpha = reveal * pulseAlpha(pulseElapsedMs);
      ctx.lineWidth = 2;
      ctx.arc(dot.x, dot.y, dotRadius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = reveal;
    }

    if (placed.has(e.id)) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const centreCross = bottom;
      const nameCross = showDate ? centreCross - (dateFontPx + lineGap) / 2 : centreCross;

      ctx.font = `600 ${fontPx}px ${uiFont}`;
      drawHaloText(ctx, axis, px + gap, nameCross, e.label, COLORS.white);

      if (showDate) {
        const dateCross = centreCross + (fontPx + lineGap) / 2;
        ctx.font = `500 ${dateFontPx}px ${monoFont}`;
        drawHaloText(ctx, axis, px + gap, dateCross, formatEventDateLine(dateOfDecimalYear(e.start)), COLORS.whiteDim);
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
  ctx: CanvasRenderingContext2D, axis: Axis, periods: readonly TimelineEntry[], periodIndexOf: ReadonlyMap<string, number>,
  viewport: Viewport, top: number, bottom: number
): void {
  for (const e of periods) {
    const span = classifySpan(e, viewport);
    const fromPx = span.mode === 'bar' ? span.fromPx : 0;
    const toPx = span.mode === 'bar' ? span.toPx : viewport.sizePx;
    if (toPx - fromPx < 1) continue;
    const colorIndex = (periodIndexOf.get(e.id) ?? 0) % PERIOD_BAND_COLORS.length;
    ctx.fillStyle = PERIOD_BAND_COLORS[colorIndex];
    const r = rectFor(axis, fromPx, toPx, top, bottom);
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
}
