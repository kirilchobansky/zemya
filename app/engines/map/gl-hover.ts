/**
 * Hover and click on the GL map: which country or capital ring the mouse is over, reported
 * once per change (and when the camera moves its label point), and the click that selects.
 */
import type { MapMouseEvent, MapTouchEvent } from 'maplibre-gl';

import type { GlHost } from './gl-host';
import { LAYER } from './gl-style';
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
    const mark = pickPlaceAt(this.host, x, y);
    const feature = mark?.feature ?? pickAt(this.host, x, y);
    if (!feature) { this.clearHover(); return; } // ocean: nothing is hovered
    // moving within one country (or one ring) is not a change: no work, no callback
    if (feature === this.hoverFeature && mark === this.hoverMark) return;
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

  /** Reports the hover with the position of the country's own label point (its anchor, the
   *  point the Names layer uses) or the hovered ring — never the pointer. `labelShown` is
   *  whether MapLibre has placed that name, in which case the app shows no tooltip. Called on a
   *  change of country and, while one is hovered, when the camera moves the point; skipped when
   *  nothing it reports changed. */
  emitHover(): void {
    const feature = this.hoverFeature;
    if (!feature) return;
    const mark = this.hoverMark;
    const at = mark ? this.host.map.project([mark.place.lon, mark.place.lat]) : this.host.map.project(feature.anchor as [number, number]);
    const x = Math.round(at.x);
    const y = Math.round(at.y);
    let labelShown = false;
    if (mark) labelShown = true; // a ring that can be hovered is drawn with its name
    else {
      labelShown = this.host.map.queryRenderedFeatures(
        [[x - 90, y - 14], [x + 90, y + 14]], { layers: [LAYER.labelsCountry, LAYER.labelsMicro] }
      ).some(hit => hit.properties?.iso3 === feature.country.iso3);
    }
    const key = `${x},${y},${labelShown}`;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.host.callbacks.onHover(feature, x, y, mark, labelShown);
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
