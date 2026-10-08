/**
 * What depends on the camera, written to the GL map: which countries are pins, halo strength,
 * which names and capitals show. Each part writes only when its answer changed.
 */
import type { GeoJSONSource } from 'maplibre-gl';

import { homeZoom } from './camera';
import { EMPTY } from './gl-geo';
import type { GlHost } from './gl-host';
import type { GlStyling } from './gl-styling';
import { FILTERED_LAYERS, LAYER, NONE, SOURCE } from './gl-style';
import { lonToX } from './projection';
import { microMode } from './style';
import type { Feature } from './types';
import { capitalShapeShowing, capitalsVisible, haloAlpha, landHidden, showsAsDot } from './visibility';

/** Minimum on-screen width before a country is worth naming (as the canvas renderer had it). */
const LABEL_MIN_WIDTH = 46;
const LABEL_ZOOM_FACTOR = 1.4;

export class GlViewSync {
  /** Last filter key per filtered layer, so setFilter runs only when a set changes. */
  private filterKeys = new Map<string, string>();
  private quizPlaceKey = '';
  private widths = new Map<string, number>();
  private measureCtx: CanvasRenderingContext2D | null = null;
  private uiFont = 'system-ui, sans-serif';

  constructor(private host: GlHost, private styling: GlStyling) {}

  setUiFont(font: string): void {
    this.uiFont = font;
    this.widths.clear();
  }

  /* ----------------------------------------------------------------- per-camera */

  /** What depends on the camera: which countries are pins, halo strength, which names and
   *  capitals show. Each part writes only when its answer changed. GlAtlas gates it on the
   *  style being in. */
  sync(): void {
    const { world, style, viewport } = this.host;
    const camera = this.host.camera;
    const micro = microMode(style);

    for (const feature of world.features) {
      this.styling.patch(feature, {
        hide: landHidden(feature, camera, micro),
        dot: showsAsDot(feature, camera, micro),
        // a halo (area) and a dot never stand for the same country
        halo: micro !== 'off' ? Math.round(haloAlpha(feature, camera) * 20) / 20 : 0
      });
    }

    // country names (largest claim first), then micro-state / island names beside their pin
    const countries: string[] = [];
    const micros: string[] = [];
    if (style.showLabels && (!style.quizMode ? camera.zoom >= homeZoom(viewport) * LABEL_ZOOM_FACTOR : style.quizNames)) {
      const named = new Set<Feature>();
      for (const feature of world.features) {
        if (!feature.bbox) continue;
        const widthPx = (lonToX(feature.bbox[2]) - lonToX(feature.bbox[0])) * camera.zoom;
        if (widthPx < LABEL_MIN_WIDTH) continue;
        const size = Math.round(Math.max(10, Math.min(14, widthPx / 7)));
        if (this.textWidth(feature.country.name, size) > widthPx * 1.05) continue;
        countries.push(feature.country.iso3);
        named.add(feature);
      }
      if (micro === 'full') {
        for (const feature of world.features) {
          if (!named.has(feature) && (showsAsDot(feature, camera, micro) || haloAlpha(feature, camera) > 0)) micros.push(feature.country.iso3);
        }
      }
    }
    this.setSet(LAYER.labelsCountry, countries);
    this.setSet(LAYER.labelsMicro, micros);

    // capitals: ring and name together, only while the layer is on and the country shows a shape
    const capitals = capitalsVisible(style, camera, viewport)
      ? world.places.filter(mark => capitalShapeShowing(mark, camera, viewport)).map(mark => mark.place.iso3)
      : [];
    this.setSet(LAYER.capitals, capitals);

    // the capitals quiz's target ring, unless its country is still drawn as a pin
    const quizPlace = style.quizMode && style.quizPlace && !landHidden(style.quizPlace.feature, camera, micro) ? style.quizPlace : null;
    const placeKey = quizPlace ? `${quizPlace.place.lon},${quizPlace.place.lat}` : '';
    if (placeKey !== this.quizPlaceKey) {
      this.quizPlaceKey = placeKey;
      (this.host.map.getSource(SOURCE.quizPlace) as GeoJSONSource).setData(
        quizPlace
          ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [quizPlace.place.lon, quizPlace.place.lat] } }
          : EMPTY
      );
    }
  }

  private setSet(layer: (typeof FILTERED_LAYERS)[number], iso3: string[]): void {
    const key = iso3.join();
    if (this.filterKeys.get(layer) === key) return;
    this.filterKeys.set(layer, key);
    this.host.map.setFilter(layer, (iso3.length ? ['in', ['get', 'iso3'], ['literal', iso3]] : NONE) as never);
  }

  private textWidth(text: string, size: number): number {
    const key = `${size}:${text}`;
    let width = this.widths.get(key);
    if (width === undefined) {
      this.measureCtx ??= document.createElement('canvas').getContext('2d');
      if (this.measureCtx) this.measureCtx.font = `500 ${size}px ${this.uiFont}`;
      width = this.measureCtx?.measureText(text).width ?? text.length * size * 0.55;
      this.widths.set(key, width);
    }
    return width;
  }
}
