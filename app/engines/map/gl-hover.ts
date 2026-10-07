/**
 * Hover and click on the GL map: which country or capital ring the mouse is over, reported
 * once per change (and when the camera moves its label point), and the click that selects.
 */
import type { MapMouseEvent, MapTouchEvent } from 'maplibre-gl';

import type { GlHost } from './gl-host';
import { pickAt, pickPlaceAt } from './gl-picking';
import type { Feature, PlaceMark } from './types';

/** A finger is imprecise: a pin or capital ring is drawn at 4-9 px but hit from a 24 px radius. */
const TOUCH_HIT_RADIUS_PX = 24;

export interface HoverHooks {
  /** A compare-outline drag is in progress: hover pauses. */
  compareDragging(): boolean;
  /** Our own camera animation runs (so a "moving" map is not a user drag). */
  easing(): boolean;
  /** The click that ends a compare drag selects nothing; true once, then cleared. */
  takeSuppressedClick(): boolean;
}

export class GlHover {
  /** The hovered country / ring and the last report made for it (see emitHover). */
  private hoverFeature: Feature | null = null;
  private hoverMark: PlaceMark | null = null;
  private hoverKey = '';
  /** Where the pointer last was over the map, in map pixels — the tooltip follows it. */
  private pointer = { x: 0, y: 0 };

  constructor(private host: GlHost, private hooks: HoverHooks) {}

  /** True while a country or ring is hovered (the camera then re-reports its label point). */
  get active(): boolean {
    return this.hoverFeature !== null;
  }

  private static isTouch(event: MouseEvent | TouchEvent | PointerEvent): boolean {
    if ('pointerType' in event) return event.pointerType === 'touch';
    if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) return true;
    return Boolean((event as { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents);
  }

  readonly onMouseMove = (e: MapMouseEvent): void => {
    if (this.hooks.compareDragging()) return;
    // a finger that is not down is not anywhere: hover is for a mouse
    if (GlHover.isTouch(e.originalEvent)) return;
    if (this.host.map.isMoving() && !this.hooks.easing()) return; // dragging the map
    const { x, y } = e.point;
    this.pointer = { x, y };
    const mark = pickPlaceAt(this.host, x, y);
    const feature = mark?.feature ?? pickAt(this.host, x, y);
    if (!feature) { this.clearHover(); return; } // ocean: nothing is hovered
    // moving within one country (or one ring) is not a change: no work, no callback
    if (feature === this.hoverFeature && mark === this.hoverMark) {
      this.host.callbacks.onPointer?.(x, y); // same country: only the tooltip moves
      return;
    }
    this.hoverFeature = feature;
    this.hoverMark = mark;
    this.hoverKey = '';
    this.emitHover();
  };

  readonly onMouseLeave = (): void => this.clearHover();

  /** Drops the hover (one country at a time, and none when nothing is under the pointer).
   *  Safe to call any time; reports only if something was hovered. */
  clearHover(): void {
    const had = this.hoverFeature !== null;
    this.hoverFeature = null;
    this.hoverMark = null;
    this.hoverKey = '';
    if (had) this.host.callbacks.onHover(null, 0, 0);
  }

  /** A finger that lifts leaves no hover behind (touch never hovers; a tap may have set one). */
  readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') this.clearHover();
  };

  /** Reports the hover with the pointer position, so the tooltip follows the mouse. Called on a
   *  change of country or ring and again when the camera moves under a hovered country. */
  emitHover(): void {
    const feature = this.hoverFeature;
    if (!feature) return;
    const { x, y } = this.pointer;
    const key = `${x},${y}`;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.host.callbacks.onHover(feature, x, y, this.hoverMark);
  }

  readonly onClick = (e: MapMouseEvent | MapTouchEvent): void => {
    if (this.hooks.takeSuppressedClick()) return;
    const touch = GlHover.isTouch(e.originalEvent as MouseEvent | TouchEvent);
    const { x, y } = e.point;
    // a capital's ring selects its COUNTRY — there is no city page
    const mark = pickPlaceAt(this.host, x, y, touch ? TOUCH_HIT_RADIUS_PX : undefined);
    this.host.callbacks.onSelect(mark?.feature ?? pickAt(this.host, x, y, touch ? TOUCH_HIT_RADIUS_PX : undefined));
  };
}
