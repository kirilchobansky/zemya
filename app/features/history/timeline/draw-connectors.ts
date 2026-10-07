/**
 * Dashed connector lines from a pinned card to its entry.
 */
import { type Axis, type PinnedCardTarget, type WireLayout } from './render-types';
import { clamp } from './render-easing';
import { project } from './render-geometry';
import { timeToPx, type EntryKind, type TimeRange, type Viewport } from './scale';

const CONNECTOR_COLOR = 'rgba(255,255,255,.4)';

const CONNECTOR_DASH: readonly [number, number] = [4, 3];

const CONNECTOR_CHEVRON_SIZE = 5;

/** The point on `rect`'s own boundary in the direction of (tx, ty) — "the card's nearest
 *  edge" a line drawn outward from its centre would first cross. */
function nearestEdgePoint(rect: { x: number; y: number; w: number; h: number }, tx: number, ty: number): { x: number; y: number } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const halfW = Math.max(rect.w / 2, 1);
  const halfH = Math.max(rect.h / 2, 1);
  const scale = Math.min(dx !== 0 ? halfW / Math.abs(dx) : Infinity, dy !== 0 ? halfH / Math.abs(dy) : Infinity);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * For every pinned card, a thin dashed line from its own nearest edge to its entry's
 * current position on the timeline — an event targets its exact date; a period/ruler/
 * government targets the midpoint of its own span (there's no single "the" position for a
 * range), at the vertical middle of its kind's wire when that wire is currently drawn, or
 * the cylinder's own middle when it isn't (the kind is filtered off, or has nothing else
 * visible right now). When the target date is off screen, the line stops at the canvas
 * edge and a small chevron points further the way it would continue.
 */
export function drawConnectorLines(
  ctx: CanvasRenderingContext2D, axis: Axis, viewport: Viewport, contentRange: TimeRange,
  wires: Partial<Record<EntryKind, WireLayout>>, cylinderTop: number, cylinderBottom: number,
  pinnedCards: readonly PinnedCardTarget[]
): void {
  if (!pinnedCards.length) return;
  ctx.save();
  ctx.strokeStyle = CONNECTOR_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash(CONNECTOR_DASH);

  for (const card of pinnedCards) {
    const t = card.kind === 'event' ? card.start : (card.start + (card.end ?? contentRange.to)) / 2;
    const rawPx = timeToPx(t, viewport);
    const wire = wires[card.kind];
    const crossMid = wire ? wire.top + wire.height / 2 : (cylinderTop + cylinderBottom) / 2;
    const onScreen = rawPx >= 0 && rawPx <= viewport.sizePx;
    const px = clamp(rawPx, 0, viewport.sizePx);
    const target = project(axis, px, crossMid);
    const from = nearestEdgePoint(card.rect, target.x, target.y);

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();

    if (!onScreen) {
      const dir = rawPx < 0 ? -1 : 1;
      const backAlong = px - dir * CONNECTOR_CHEVRON_SIZE * 1.6;
      const tip = project(axis, px, crossMid);
      const backA = project(axis, backAlong, crossMid - CONNECTOR_CHEVRON_SIZE);
      const backB = project(axis, backAlong, crossMid + CONNECTOR_CHEVRON_SIZE);
      ctx.save();
      ctx.setLineDash([]);
      ctx.fillStyle = CONNECTOR_COLOR;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(backA.x, backA.y);
      ctx.lineTo(backB.x, backB.y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}
