/**
 * Hover state of HistoryTimeline (timeline.ts): the hit regions of the last frame, the
 * hovered id, and the throttled pointermove check (one hit-test per animation frame).
 */
import type { HitRegion, TimelineEntry } from './renderer';
import { hitTestRegions } from './timeline-model';
import type { HistoryHover } from './timeline-config';

export interface HoverHost {
  entries(): readonly TimelineEntry[];
  onHover(hover: HistoryHover | null): void;
  draw(): void;
  /** True while a drag or pinch is in progress — no hover then. */
  isGesturing(): boolean;
}

export class TimelineHover {
  /** Every hoverable region drawn last frame (render()'s return value) — hit-tested
   *  against on pointermove, never recomputed outside a frame. */
  hits: HitRegion[] = [];
  hoveredId: string | null = null;
  /** Latest pointer position (canvas CSS px), consumed by the throttled hover check —
   *  set on every pointermove, read at most once per animation frame. */
  private pendingHoverPoint: { x: number; y: number } | null = null;
  private hoverQueued = 0;

  constructor(private canvas: HTMLCanvasElement, private host: HoverHost) {}

  /** The hover payload (entry + its region's rect) for `id`, or null if either is gone. */
  describe(id: string | null): HistoryHover | null {
    const region = id ? this.hits.find(h => h.id === id) ?? null : null;
    const entry = id ? this.host.entries().find(e => e.id === id) ?? null : null;
    return region && entry ? { entry, rect: { x: region.x, y: region.y, w: region.w, h: region.h } } : null;
  }

  /** Sets hoveredId (if changed), updates the cursor and fires onHover — the one place
   *  any of those three happen, so they can never drift out of sync. */
  setHovered(id: string | null): void {
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.canvas.style.cursor = id ? 'pointer' : '';
    this.host.onHover(this.describe(id));
    this.host.draw(); // repaint with the new hover highlight
  }

  /** No hover while dragging or pinch-zooming (module header) — drops any pending
   *  throttled check too, so a stale point can't win the race once the gesture ends. */
  clear(): void {
    this.pendingHoverPoint = null;
    cancelAnimationFrame(this.hoverQueued);
    this.hoverQueued = 0;
    this.setHovered(null);
  }

  hitTest(x: number, y: number): HitRegion | null {
    return hitTestRegions(this.hits, x, y);
  }

  private flushHoverCheck = (): void => {
    this.hoverQueued = 0;
    const point = this.pendingHoverPoint;
    if (!point || this.host.isGesturing()) return;
    this.setHovered(this.hitTest(point.x, point.y)?.id ?? null);
  };

  /** Throttled to at most one hit-test per animation frame, however many pointermove
   *  events arrive in between. */
  queueCheck(x: number, y: number): void {
    this.pendingHoverPoint = { x, y };
    if (!this.hoverQueued) this.hoverQueued = requestAnimationFrame(this.flushHoverCheck);
  }

  destroy(): void {
    cancelAnimationFrame(this.hoverQueued);
  }
}
