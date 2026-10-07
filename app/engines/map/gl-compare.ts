/**
 * The comparison outline: a country's shape dragged over the map at true size, plus the
 * capture-phase input handling that lets a drag starting on it move the outline, not the map
 * (and keeps the keyboard where it is during a quiz run).
 */
import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource } from 'maplibre-gl';

import { worldToScreen } from './camera';
import { EMPTY, outlineFeature } from './gl-geo';
import type { GlHost } from './gl-host';
import { pickAt } from './gl-picking';
import { LAYER, SOURCE } from './gl-style';
import { latToY, lonToX, wrapX, xToLon } from './projection';
import { reprojectPolygonsToTrueSize } from './topology';
import type { Feature } from './types';

interface CompareState {
  feature: Feature;
  lon: number;
  lat: number;
  dragging: boolean;
  moved: boolean;
}

export class GlCompare {
  private compare: CompareState | null = null;
  private compareFrame = 0;
  private suppressClick = false;
  private keepFocus = false;

  constructor(private host: GlHost) {}

  setKeepFocus(keep: boolean): void {
    this.keepFocus = keep;
  }

  /** True while the outline is being dragged. */
  get dragging(): boolean {
    return Boolean(this.compare?.dragging);
  }

  /** The click that ends a compare drag selects nothing: true once, then cleared. */
  takeSuppressedClick(): boolean {
    if (!this.suppressClick) return false;
    this.suppressClick = false;
    return true;
  }

  destroy(): void {
    cancelAnimationFrame(this.compareFrame);
    this.endCompareDrag();
  }

  startCompare(feature: Feature): boolean {
    if (!feature.polygons.length) return false;
    const [lon, lat] = feature.anchor;
    this.compare = { feature, lon, lat, dragging: false, moved: false };
    this.drawCompare();
    this.emitCompare();
    return true;
  }

  stopCompare(): void {
    this.compare = null;
    this.endCompareDrag();
    (this.host.map.getSource(SOURCE.compare) as GeoJSONSource | undefined)?.setData(EMPTY);
  }

  get comparing(): Feature | null {
    return this.compare?.feature ?? null;
  }

  /* ------------------------------------------------------------ the compare outline */

  /** Capture phase, before MapLibre's own handlers: keeps the keyboard where it is during a
   *  quiz run, and lets a drag that starts on the comparison outline move the outline, not the map. */
  readonly onCaptureStart = (e: MouseEvent | TouchEvent): void => {
    if (this.keepFocus && e.cancelable) e.preventDefault();
    if (!this.compare) return;
    const point = this.eventPoint(e);
    if (!point || !this.host.map.queryRenderedFeatures([point.x, point.y], { layers: [LAYER.compareFill] }).length) return;
    e.stopImmediatePropagation();
    this.compare.dragging = true;
    this.compare.moved = false;
    window.addEventListener('mousemove', this.onCompareMove);
    window.addEventListener('mouseup', this.onCompareEnd);
    window.addEventListener('touchmove', this.onCompareMove, { passive: false });
    window.addEventListener('touchend', this.onCompareEnd);
    window.addEventListener('touchcancel', this.onCompareEnd);
  };

  private eventPoint(e: MouseEvent | TouchEvent): { x: number; y: number } | null {
    const source = 'touches' in e ? e.touches[0] ?? e.changedTouches[0] : e;
    if (!source) return null;
    const rect = this.host.container.getBoundingClientRect();
    return { x: source.clientX - rect.left, y: source.clientY - rect.top };
  }

  private onCompareMove = (e: MouseEvent | TouchEvent): void => {
    if (!this.compare?.dragging) return;
    const point = this.eventPoint(e);
    if (!point) return;
    if (e.cancelable) e.preventDefault();
    const { lng, lat } = this.host.map.unproject([point.x, point.y]);
    this.compare.lon = xToLon(wrapX(lonToX(lng)));
    this.compare.lat = Math.max(-84, Math.min(84, lat));
    this.compare.moved = true;
    this.drawCompare();
    this.emitCompare();
  };

  private onCompareEnd = (): void => {
    if (this.compare?.moved) this.suppressClick = true; // the click that ends a drag selects nothing
    this.endCompareDrag();
  };

  endCompareDrag(): void {
    if (this.compare) this.compare.dragging = false;
    window.removeEventListener('mousemove', this.onCompareMove);
    window.removeEventListener('mouseup', this.onCompareEnd);
    window.removeEventListener('touchmove', this.onCompareMove);
    window.removeEventListener('touchend', this.onCompareEnd);
    window.removeEventListener('touchcancel', this.onCompareEnd);
  }

  /** At most one geometry update per animation frame, however fast the pointer moves. */
  private drawCompare(): void {
    if (this.compareFrame) return;
    this.compareFrame = requestAnimationFrame(() => {
      this.compareFrame = 0;
      const compare = this.compare;
      if (!compare || this.host.destroyed) return;
      const data: FeatureCollection = {
        type: 'FeatureCollection',
        features: [outlineFeature(reprojectPolygonsToTrueSize(compare.feature, compare.lon, compare.lat))]
      };
      (this.host.map.getSource(SOURCE.compare) as GeoJSONSource).setData(data);
    });
  }

  private emitCompare(): void {
    if (!this.compare) return;
    const [sx, sy] = worldToScreen(this.host.camera, this.host.viewport, lonToX(this.compare.lon), latToY(this.compare.lat));
    const over = pickAt(this.host, sx, sy);
    this.host.callbacks.onCompareMove?.(this.compare.feature, over === this.compare.feature ? null : over);
  }
}
