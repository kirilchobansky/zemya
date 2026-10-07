/**
 * Pointer and wheel gestures of HistoryTimeline (timeline.ts): drag-to-pan, two-finger
 * pinch, wheel zoom and click detection. Every gesture holds the moment under the pointer
 * fixed, then clamps — the same technique as the map's Atlas, one dimension smaller.
 */
import type { Axis } from './renderer';
import { clampCenter, clampPxPerYear, pxToTime, type TimeRange, type Viewport } from './scale';
import type { HistoryHover } from './timeline-config';
import { CLICK_MOVE_THRESHOLD_PX, DRAG_THRESHOLD_PX, WHEEL_LINE_SENSITIVITY, WHEEL_SENSITIVITY } from './timeline-config';
import type { TimelineHover } from './timeline-hover';

export interface GestureHost {
  canvas: HTMLCanvasElement;
  axis: Axis;
  viewport(): Viewport;
  setViewport(viewport: Viewport): void;
  contentRange(): TimeRange;
  pannableRange(): TimeRange;
  draw(): void;
  /** Any drag/pinch/wheel cancels an in-flight flyTo immediately. */
  cancelFly(): void;
  hover: TimelineHover;
  onEntryClick(hit: HistoryHover): void;
}

export class TimelineGestures {
  /** The pointer + hit id a pointerdown started on, kept until its matching pointerup so a
   *  same-spot click can be told apart from a drag (see CLICK_MOVE_THRESHOLD_PX). Cleared
   *  on a two-pointer (pinch) gesture — a click never fires out of a pinch. */
  private clickCandidate: { pointerId: number; clientX: number; clientY: number; id: string | null } | null = null;
  private drag: { alongClient: number; center: number } | null = null;
  private moved = false;
  private pointers = new Map<number, number>(); // pointerId -> along-axis client coordinate
  /** Two-finger gesture: the moment that started under the fingers' midpoint stays under
   *  it, so a pinch zooms about where you're pinching (same technique as Atlas's pinch,
   *  in one dimension). */
  private pinch: { distance: number; pxPerYear: number; time: number } | null = null;

  constructor(private host: GestureHost) {
    const c = host.canvas;
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerUp);
    c.addEventListener('pointerleave', this.onPointerUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
  }

  destroy(): void {
    const c = this.host.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerUp);
    c.removeEventListener('pointerleave', this.onPointerUp);
    c.removeEventListener('wheel', this.onWheel);
  }

  /** True while a drag or pinch is in progress. */
  get active(): boolean {
    return !!(this.drag || this.pinch);
  }

  /** The along-axis, CANVAS-relative coordinate of a pointer/wheel event (offsetX/Y, not
   *  clientX/Y — same convention as Atlas, since viewport math below is relative to the
   *  canvas's own origin, not the page's). The one place gesture code decides which
   *  screen axis is "time" (X for horizontal, Y for vertical) — the gesture-side
   *  counterpart of project() on the drawing side. */
  private along(e: { offsetX: number; offsetY: number }): number {
    return this.host.axis === 'horizontal' ? e.offsetX : e.offsetY;
  }

  private onPointerDown = (e: PointerEvent): void => {
    const { canvas, hover } = this.host;
    canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.along(e));
    hover.clear();
    this.host.cancelFly(); // any drag/pinch cancels an in-flight flyTo immediately

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { distance: Math.abs(a - b), pxPerYear: this.host.viewport().pxPerYear, time: pxToTime((a + b) / 2, this.host.viewport()) };
      this.drag = null;
      this.clickCandidate = null;
      canvas.classList.remove('is-dragging');
      return;
    }

    this.drag = { alongClient: this.along(e), center: this.host.viewport().center };
    this.moved = false;
    canvas.classList.add('is-dragging');
    this.clickCandidate = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, id: hover.hitTest(e.offsetX, e.offsetY)?.id ?? null };
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, this.along(e));
    const viewport = this.host.viewport();

    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.abs(a - b);
      const mid = (a + b) / 2;
      const rawPxPerYear = this.pinch.pxPerYear * (distance / Math.max(this.pinch.distance, 1));
      const pxPerYear = clampPxPerYear(rawPxPerYear, viewport.sizePx, this.host.contentRange());
      const rawCenter = this.pinch.time - (mid - viewport.sizePx / 2) / pxPerYear;
      const center = clampCenter(rawCenter, pxPerYear, viewport.sizePx, this.host.pannableRange());
      this.host.setViewport({ ...viewport, pxPerYear, center });
      this.host.draw();
      return;
    }

    if (this.drag) {
      const deltaPx = this.along(e) - this.drag.alongClient;
      if (Math.abs(deltaPx) > DRAG_THRESHOLD_PX) this.moved = true;
      const rawCenter = this.drag.center - deltaPx / viewport.pxPerYear;
      const center = clampCenter(rawCenter, viewport.pxPerYear, viewport.sizePx, this.host.pannableRange());
      this.host.setViewport({ ...viewport, center });
      this.host.draw();
      return;
    }

    if (e.pointerType === 'touch') return; // a finger has no hover: it would stick on the last pin it touched
    this.host.hover.queueCheck(e.offsetX, e.offsetY);
  };

  /** Resolves this frame's pending click candidate (set on pointerdown) into a fired
   *  onEntryClick, if the matching pointerup landed within CLICK_MOVE_THRESHOLD_PX of it —
   *  a real 'pointerup' only, never pointercancel/pointerleave (both routed here too), and
   *  never mid-pinch (pointers.size is still 1, checked BEFORE the delete below). */
  private resolveClick(e: PointerEvent): void {
    const candidate = this.clickCandidate;
    if (e.type !== 'pointerup' || !candidate || candidate.pointerId !== e.pointerId || !candidate.id || this.pointers.size !== 1) return;
    const dist = Math.hypot(e.clientX - candidate.clientX, e.clientY - candidate.clientY);
    if (dist >= CLICK_MOVE_THRESHOLD_PX) return;
    const hit = this.host.hover.describe(candidate.id);
    if (hit) this.host.onEntryClick(hit);
  }

  private onPointerUp = (e: PointerEvent): void => {
    this.resolveClick(e);
    this.clickCandidate = null;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    this.host.canvas.classList.remove('is-dragging');
    this.drag = null;
    this.host.hover.clear();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.host.hover.clear();
    this.host.cancelFly(); // wheel cancels an in-flight flyTo immediately
    const viewport = this.host.viewport();
    const along = this.along(e);
    const time = pxToTime(along, viewport); // the moment under the cursor
    const sensitivity = e.deltaMode === 1 ? WHEEL_LINE_SENSITIVITY : WHEEL_SENSITIVITY;
    const rawPxPerYear = viewport.pxPerYear * Math.exp(-e.deltaY * sensitivity);
    const pxPerYear = clampPxPerYear(rawPxPerYear, viewport.sizePx, this.host.contentRange());
    // hold the moment under the cursor still, then clamp the result to the pannable range
    const rawCenter = time - (along - viewport.sizePx / 2) / pxPerYear;
    const center = clampCenter(rawCenter, pxPerYear, viewport.sizePx, this.host.pannableRange());
    this.host.setViewport({ ...viewport, pxPerYear, center });
    this.host.draw();
  };
}
