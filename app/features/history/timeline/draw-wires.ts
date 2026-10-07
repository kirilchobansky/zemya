/**
 * Lane tracks and the period/ruler/government capsules drawn on them.
 */
import { type Axis, type TimelineEntry, type HitRegion, type WireLayout } from './render-types';
import { hexToRgba, shade, COLORS, RENDER_CONFIG, kindColorHex } from './render-colors';
import { clamp, activeAmounts, pulseAlpha } from './render-easing';
import { rectFor, drawHaloText, truncateToFit } from './render-geometry';
import { classifySpan } from './layout';
import { type EntryKind, type Viewport } from './scale';

const LANE_TRACK_FILL = 'rgba(255,255,255,.035)';

const LANE_TRACK_BORDER = 'rgba(255,255,255,.07)';

const LANE_TRACK_RADIUS = 14;

/** The lane track `kind`'s wire sits on: a full-width rounded rect (radius 14, faint white
 *  fill + border) — "each wire is a lane track", replacing the old cylinder's own shell as
 *  the visual container. Drawn once per wire, not per sub-row (sub-rows read purely from
 *  capsule vertical position within it). */
export function drawLaneTrack(ctx: CanvasRenderingContext2D, axis: Axis, sizePx: number, wire: WireLayout): void {
  if (wire.height < 1) return;
  const r = rectFor(axis, 0, sizePx, wire.top, wire.top + wire.height);
  const radius = Math.min(LANE_TRACK_RADIUS, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  ctx.fillStyle = LANE_TRACK_FILL;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = LANE_TRACK_BORDER;
  ctx.stroke();
}

/** Idle → active interpolation for a capsule's own fill alpha/hue, border alpha/width and
 *  glow — driven by `amt` (0 = idle, 1 = fully active), which render()'s activeAmounts map
 *  eases toward its target over ~120ms (see updateActiveAmounts). No dimension in this
 *  table ever changes the capsule's SIZE or shape — only fill/border/glow/weight, per the
 *  "active items keep their exact size and shape" brief. Idle: fill at 0.30 alpha, 1px
 *  border at 0.65 alpha. Active: fill at 0.55 alpha (mixed slightly toward white via
 *  `whiteMix`), 1.6px border at full alpha, same soft glow. */
function activeCapsuleStyle(amt: number): { fillAlpha: number; whiteMix: number; borderAlpha: number; borderWidth: number; glowAlpha: number; bold: boolean } {
  return {
    fillAlpha: 0.3 + amt * 0.25,
    whiteMix: amt * 0.15,
    borderAlpha: 0.65 + amt * 0.35,
    borderWidth: 1 + amt * 0.6,
    glowAlpha: amt * 0.45,
    bold: amt > 0.5
  };
}

/**
 * `kind`'s visible period/ruler/government entries as rounded capsules (radius 10) on
 * `wire`: a flat fill in the kind's own colour at low alpha, a 1px border at higher alpha,
 * the name centred inside the capsule's own VISIBLE portion (classifySpan already
 * clips fromPx/toPx to the viewport, so the midpoint used for centring is always the
 * midpoint of what's actually on screen), clipped and truncated to the capsule's own width.
 * A capsule wider than the viewport (classifySpan's "pinned" mode) still draws spanning the
 * whole width, so it never disappears just because neither of its own ends is on screen.
 * Every entry whose span contains the centre date is "active" (see render()'s activeIds —
 * ALL of them at once, not just one) and gets a brighter fill/border, a soft glow and bold
 * text, eased in/out over ~120ms (activeAmounts) — never a size change. Events are pins,
 * not capsules — see drawEventPins.
 */
export function drawWireCapsules(
  ctx: CanvasRenderingContext2D, axis: Axis, uiFont: string, kind: EntryKind,
  entries: readonly TimelineEntry[], rows: ReadonlyMap<string, number>, viewport: Viewport,
  wire: WireLayout, activeAmounts: ReadonlyMap<string, number>,
  hoveredId: string | null, pinnedIds: ReadonlySet<string>,
  pulseId: string | null, pulseElapsedMs: number, hits: HitRegion[]
): void {
  const kindHex = kindColorHex(kind);
  const byRow = new Map<number, TimelineEntry[]>();
  for (const e of entries) {
    const row = rows.get(e.id) ?? 0;
    (byRow.get(row) ?? byRow.set(row, []).get(row)!).push(e);
  }

  for (const [row, rowEntries] of byRow) {
    if (row >= wire.subRows) continue; // defensive: subRows is computed from this same set
    const rowTop = wire.top + row * wire.rowHeight;
    const rowMid = rowTop + wire.rowHeight / 2;
    const fontPx = clamp(wire.rowHeight * 0.42, RENDER_CONFIG.capsuleMinFontPx, RENDER_CONFIG.capsuleMaxFontPx);
    const h = Math.max(4, wire.rowHeight - RENDER_CONFIG.capsuleGapPx);
    const cross0 = rowMid - h / 2;
    const cross1 = rowMid + h / 2;

    for (const e of rowEntries) {
      const isHovered = e.id === hoveredId;
      const amt = activeAmounts.get(e.id) ?? 0;
      const style = activeCapsuleStyle(amt);

      let fromPx: number;
      let toPx: number;
      const span = classifySpan(e, viewport);
      if (span.mode === 'bar') {
        fromPx = span.fromPx + RENDER_CONFIG.capsuleGapPx / 2;
        toPx = span.toPx - RENDER_CONFIG.capsuleGapPx / 2;
      } else {
        fromPx = RENDER_CONFIG.capsuleGapPx;
        toPx = viewport.sizePx - RENDER_CONFIG.capsuleGapPx;
      }
      // "Always drawn as bars... thin coloured strips at far zoom" — never skipped for
      // being narrow, just floored to a minimum visible width around its own centre.
      if (toPx - fromPx < RENDER_CONFIG.minBarWidthPx) {
        const centre = (fromPx + toPx) / 2;
        fromPx = centre - RENDER_CONFIG.minBarWidthPx / 2;
        toPx = centre + RENDER_CONFIG.minBarWidthPx / 2;
      }

      const r = rectFor(axis, fromPx, toPx, cross0, cross1);
      const radius = Math.min(RENDER_CONFIG.capsuleCornerRadiusPx, r.w / 2, r.h / 2);
      hits.push({ id: e.id, x: r.x, y: r.y, w: r.w, h: r.h, tier: e.tier });

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, radius);
      const fillHex = style.whiteMix > 0 ? shade(kindHex, -style.whiteMix) : kindHex;
      ctx.fillStyle = hexToRgba(fillHex, style.fillAlpha + (isHovered ? 0.08 : 0));
      ctx.fill();

      // The glow only applies to the border stroke — reset before any further (hover/
      // pinned/pulse) outline so those never inherit it.
      if (style.glowAlpha > 0.01) {
        ctx.shadowColor = hexToRgba(kindHex, style.glowAlpha);
        ctx.shadowBlur = 10 * amt;
      }
      ctx.lineWidth = style.borderWidth;
      ctx.strokeStyle = hexToRgba(kindHex, style.borderAlpha);
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (isHovered) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = COLORS.white;
        ctx.stroke();
      } else if (pinnedIds.has(e.id)) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = COLORS.white;
        ctx.stroke();
      }
      if (e.id === pulseId) {
        ctx.globalAlpha = pulseAlpha(pulseElapsedMs);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = COLORS.white;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const nameColor = COLORS.white;
      const roleColor = COLORS.whiteDim;

      const availableTextPx = (axis === 'horizontal' ? r.w : r.h) - RENDER_CONFIG.capsuleHPad * 2;
      if (availableTextPx > 6) {
        const crossPx = axis === 'horizontal' ? r.h : r.w;
        const roleFontPx = fontPx * 0.7;
        const lineGap = 2;
        const showRole = (kind === 'ruler' || kind === 'government') && !!e.role && crossPx >= fontPx + roleFontPx + lineGap + 2;
        // Centre text on the capsule's own VISIBLE midpoint (fromPx/toPx are already
        // clamped to the viewport by classifySpan) — never the entry's true, possibly
        // off-screen, midpoint.
        const visibleMid = (fromPx + toPx) / 2;

        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.font = `${style.bold ? 700 : 500} ${fontPx}px ${uiFont}`;
        const nameText = truncateToFit(ctx, e.label, availableTextPx);

        if (showRole) {
          const nameCross = rowMid - (roleFontPx + lineGap) / 2;
          const roleCross = rowMid + (fontPx + lineGap) / 2;
          if (nameText) drawHaloText(ctx, axis, visibleMid, nameCross, nameText, nameColor);
          ctx.font = `500 ${roleFontPx}px ${uiFont}`;
          const roleText = truncateToFit(ctx, e.role!, availableTextPx);
          if (roleText) drawHaloText(ctx, axis, visibleMid, roleCross, roleText, roleColor);
        } else if (nameText) {
          drawHaloText(ctx, axis, visibleMid, rowMid, nameText, nameColor);
        }
        ctx.restore();
      }
      ctx.restore();
    }
  }
}
