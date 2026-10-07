/**
 * Canvas renderer for the history timeline. Pure draw functions — no React, no DOM
 * beyond the CanvasRenderingContext2D they're handed. Mirrors app/engines/map/renderer.ts's
 * shape (one RenderContext, one entry-point `render()`, a literal COLORS object) but for
 * the 1D time axis instead of the 2D Mercator world.
 *
 * "Calm and dark" look: a flat vertical page-background gradient (drawBackground), a
 * single full-width content band, vertically centred and completely static — same size,
 * same position at every zoom level and pan position, a pure function of the lane layout
 * (see totalWiresHeightPx/layoutWires), never of viewport.pxPerYear. Everything except the
 * centre date readout lives INSIDE it: year
 * ticks on top, then horizontal "wires" stacked by duration (periods, rulers, governments,
 * events), each drawn as its own translucent rounded lane track (drawLaneTrack) with
 * entries as flat rounded capsules sitting inside it — no 3D gradients, highlights or
 * per-entry size changes; an entry containing the viewport centre only brightens (fill/
 * border/glow, eased over ~120ms), it never grows.
 *
 * Every function takes `axis` and goes through `project()`/`rectFor()`/`drawHaloText()`
 * to turn an (along-axis, cross-axis) position into real canvas x/y — nothing below ever
 * writes `ctx.something(x, y)` with x or y read directly off a Viewport or a screen
 * event. Only "horizontal" is driven by a route today (app/routes/history/history.$slug.tsx);
 * "vertical" exists so a later globe-timeline or sidebar layout costs a parameter, not a
 * rewrite.
 *
 * Colors are literals, not CSS custom properties — canvas can't read a custom property
 * cheaply every frame, same reasoning as app/engines/map/renderer.ts's COLORS. Keep these in
 * sync with app/shared/styles/tokens.css by hand where they correspond (see that file's own
 * "change one, change both") — the per-kind colours (period/ruler/government/event) are
 * new, canvas-only variants with no token equivalent.
 *
 * Every label on this page — ticks, capsules, the two out-of-range zone labels — goes
 * through placeLabels() (layout.ts) or is truncated to its own capsule's width
 * (truncateToFit), so a crowded zoom drops or shortens text instead of overlapping it.
 * Text is in the country's own language (entry.label — see catalog.server.ts; Bulgarian is Cyrillic): both canvas fonts
 * are read from CSS custom properties that resolve to Archivo/IBM Plex Mono, which carry
 * Cyrillic; app/features/history/timeline/timeline.ts additionally waits on `document.fonts.ready`
 * before trusting the font read at mount, so a frame drawn before the webfont finishes
 * loading gets corrected rather than staying stuck on a Latin-only fallback.
 */
import { type TimelineEntry, type HitRegion, type RenderContext } from './render-types';
import { RENDER_CONFIG, WIRE_ORDER } from './render-colors';
import { clamp, activeAmounts, updateActiveAmounts } from './render-easing';
import { rangeVisible, rectFor } from './render-geometry';
import { drawBackground, drawOutOfRangeFade } from './draw-background';
import { drawTopTicks } from './draw-ticks';
import { layoutWires, totalWiresHeightPx } from './wire-layout';
import { drawLaneTrack, drawWireCapsules } from './draw-wires';
import { PIN_ACTIVE_RADIUS_PX, drawEventPins, drawPeriodBands } from './draw-pins';
import { drawConnectorLines } from './draw-connectors';
import { drawCentreCylinderLine, drawCentreDate } from './draw-centre';
import { assignRows, contextAt, laneSubRowCounts } from './layout';
import { levelFor, timeToPx, type EntryKind } from './scale';

export type { Axis, TimelineEntry, HitRegion, PinnedCardTarget, RenderContext } from './render-types';
export { RENDER_CONFIG } from './render-colors';

/**
 * One frame: background, the cylinder shell (rounded, gradient, vignette, shadow), the
 * out-of-range fade + labels, the period colour wash, each visible wire's rail + capsules
 * (period, ruler, government, event, in that order — see WIRE_ORDER), the top-surface
 * ticks, then the centre line and date readout on top of everything. `entries` is the
 * WHOLE dataset — row assignment and the focus lookup both need it complete; this
 * function culls to what's on screen itself, per draw call, via rangeVisible (time-range
 * only, no tier check — period/ruler/government are always drawn; events tier-fade at
 * draw time instead, see drawEventPins/eventTierReveal). Zoom changes label detail only
 * (text fit, pin fonts) — the cylinder and every lane inside it are a fixed size, never
 * whether an entry is there at all.
 *
 * Returns every hoverable region drawn this frame (capsules and pins, not the period
 * colour wash) — app/features/history/timeline/timeline.ts keeps the latest array and hit-tests the
 * pointer against it, throttled to once per animation frame.
 */
export function render(rc: RenderContext, entries: readonly TimelineEntry[]): HitRegion[] {
  const s = phoneScale(rc, entries);
  if (s === 1) return renderAt(rc, entries);
  // Everything is laid out in logical px (screen px / s) and drawn through a uniform scale, so
  // text, lanes and capsules shrink together; the time mapping lands on the same screen
  // positions. Hit regions and pinned-card rects cross the boundary, so they are converted.
  const { ctx, viewport, crossInsets } = rc;
  const sized = { ...viewport, sizePx: viewport.sizePx / s, pxPerYear: viewport.pxPerYear / s };
  const hits = renderAt({
    ...rc, viewport: sized, crossSizePx: rc.crossSizePx / s,
    crossInsets: { start: crossInsets.start / s, end: crossInsets.end / s },
    pinnedCards: rc.pinnedCards.map(c => ({ ...c, rect: { x: c.rect.x / s, y: c.rect.y / s, w: c.rect.w / s, h: c.rect.h / s } }))
  }, entries, viewport.pxPerYear, s);
  return hits.map(h => ({ ...h, x: h.x * s, y: h.y * s, w: h.w * s, h: h.h * s }));
}

/** Phone portrait (insets set): shrink the whole cylinder to fit the strip the HUD and sheet
 *  leave, with room for the centre-date line and a little air. 1 elsewhere. Never below 0.6. */
function phoneScale(rc: RenderContext, entries: readonly TimelineEntry[]): number {
  const { crossInsets, crossSizePx } = rc;
  if (crossInsets.start <= 0 && crossInsets.end <= 0) return 1;
  const thickness = RENDER_CONFIG.tickStripHeight + RENDER_CONFIG.wirePaddingTop
    + RENDER_CONFIG.wirePaddingBottom + totalWiresHeightPx(laneSubRowCounts(entries));
  const need = thickness + RENDER_CONFIG.centreDateGap + RENDER_CONFIG.centreDateFontPx + 6 + 16;
  return clamp((crossSizePx - crossInsets.start - crossInsets.end) / need, 0.6, 1);
}

function renderAt(rc: RenderContext, entries: readonly TimelineEntry[], levelPxPerYear?: number, scale = 1): HitRegion[] {
  const { ctx, viewport, axis, crossSizePx, crossInsets, dpr, uiFont, monoFont, contentRange, pastLabel, futureLabel, hoveredId, pinnedIds, pulseId, pulseElapsedMs, pinnedCards } = rc;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

  const full = rectFor(axis, 0, viewport.sizePx, 0, crossSizePx);
  ctx.clearRect(full.x, full.y, full.w, full.h);
  const canvasHeightPx = axis === 'horizontal' ? crossSizePx : viewport.sizePx;
  drawBackground(ctx, full, canvasHeightPx);

  const rows = assignRows(entries);
  const subRowCounts = laneSubRowCounts(entries);
  // The cylinder is completely static: same size, same centred position at every zoom
  // level and every pan position — a pure function of the lane layout (subRowCounts, which
  // depends only on the dataset's own shape), never of viewport.pxPerYear or any eased
  // animation target.
  const thickness = RENDER_CONFIG.tickStripHeight + RENDER_CONFIG.wirePaddingTop
    + RENDER_CONFIG.wirePaddingBottom + totalWiresHeightPx(subRowCounts);
  // Centred in the uncovered strip; below the top inset the centre-date readout still needs
  // its own line above the cylinder. With no insets (desktop) this is the plain centre.
  const visibleMid = crossInsets.start + (crossSizePx - crossInsets.start - crossInsets.end) / 2;
  const minTop = crossInsets.start > 0 ? crossInsets.start + RENDER_CONFIG.centreDateGap + RENDER_CONFIG.centreDateFontPx + 6 : -Infinity;
  const cylinderTop = Math.max(visibleMid - thickness / 2, minTop);
  const cylinderBottom = cylinderTop + thickness;

  drawOutOfRangeFade(ctx, axis, monoFont, viewport, cylinderTop, cylinderBottom, contentRange, pastLabel, futureLabel);

  const contentTop = cylinderTop + RENDER_CONFIG.tickStripHeight + RENDER_CONFIG.wirePaddingTop;
  const wires = layoutWires(subRowCounts, contentTop);
  const contentBottom = wires.event.top + wires.event.height;

  const visible = rangeVisible(entries, viewport);
  const visibleByKind: Record<EntryKind, TimelineEntry[]> = { period: [], ruler: [], government: [], event: [] };
  for (const e of visible) visibleByKind[e.kind].push(e);

  const allPeriods = entries.filter(e => e.kind === 'period').sort((a, b) => a.start - b.start);
  const periodIndexOf = new Map(allPeriods.map((e, i) => [e.id, i] as const));
  drawPeriodBands(ctx, axis, visibleByKind.period, periodIndexOf, viewport, contentTop, contentBottom);

  // Every period/ruler/government entry whose span contains the viewport centre is
  // active, ALL of them at once (contextAt's `.all`, not just `.primary`) — "an item is
  // active when the viewport centre is inside its time range... ALL overlapping items at
  // the centre are active, not only one." No single "the" focus is picked any more (no
  // size change to arbitrate between siblings).
  const focus = contextAt(entries, viewport.center);
  const activeIds = new Set<string>([...focus.period.all, ...focus.ruler.all, ...focus.government.all].map(e => e.id));

  // Event pins get the same idle→active treatment (thicker line, bigger dot — never a
  // label size change) when their exact date sits close to the centre marker, rather than
  // by containment (an event has no range to contain anything).
  for (const e of visibleByKind.event) {
    if (Math.abs(timeToPx(e.start, viewport) - viewport.sizePx / 2) < PIN_ACTIVE_RADIUS_PX) activeIds.add(e.id);
  }
  const activeAmounts = updateActiveAmounts(activeIds);

  const hits: HitRegion[] = [];
  const level = levelFor(levelPxPerYear ?? viewport.pxPerYear);
  for (const kind of WIRE_ORDER) {
    const wire = wires[kind];
    drawLaneTrack(ctx, axis, viewport.sizePx, wire);
    if (kind === 'event') {
      drawEventPins(ctx, axis, uiFont, monoFont, visibleByKind.event, viewport, wire, level, activeAmounts, hoveredId, pinnedIds, pulseId, pulseElapsedMs, hits);
      continue;
    }
    drawWireCapsules(ctx, axis, uiFont, kind, visibleByKind[kind], rows, viewport, wire, activeAmounts, hoveredId, pinnedIds, pulseId, pulseElapsedMs, hits);
  }

  drawTopTicks(ctx, axis, monoFont, viewport, cylinderTop);
  drawConnectorLines(ctx, axis, viewport, contentRange, wires, cylinderTop, cylinderBottom, pinnedCards);
  drawCentreCylinderLine(ctx, axis, viewport, cylinderTop, cylinderBottom);
  drawCentreDate(ctx, axis, monoFont, viewport, cylinderTop);

  return hits;
}
