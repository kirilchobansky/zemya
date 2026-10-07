/**
 * Feature state and static-layer paint of the GL map: what the app's Style decides (colours,
 * borders, focus) written to MapLibre, only where it changed, plus the per-theme capital ring
 * image and the graticule's zoom ranges.
 */
import { GRATICULE_STEPS } from './gl-geo';
import type { GeoJSONSource } from 'maplibre-gl';

import { homeZoom } from './camera';
import type { GlHost } from './gl-host';
import { buildLayers, CAPITAL_RING_IMAGE, pxToZoom, SOURCE, type GlPalette } from './gl-style';
import { COLORS } from './style';
import { CAPITAL_RING_HALO, CAPITAL_RING_RADIUS } from './thresholds';
import type { Feature } from './types';

const TRANSPARENT = 'rgba(0,0,0,0)';

export type StateValue = string | number | boolean;
/** Which feature-state keys belong to which source (so a pin colour is not also sent to the land). */
const COUNTRY_KEYS = ['c', 'hide', 'sc', 'sw'];
const PIN_KEYS = ['pc', 'fo', 'dot'];
const HALO_KEYS = ['pc', 'halo'];

export class GlStyling {
  /** Last feature-state written per country, so only changes reach MapLibre. */
  private applied = new Map<string, Record<string, StateValue>>();
  private graticuleHome = 0;
  private lastBorder = '';

  constructor(private host: GlHost) {}

  palette(): GlPalette {
    return { border: this.host.style.defaultStroke?.() ?? ['rgba(10,16,23,.92)', 1] };
  }

  /** Writes the changed keys of one country's state — to the sources that read them. */
  patch(feature: Feature, values: Record<string, StateValue>): void {
    const id = feature.country.iso3;
    const prev = this.applied.get(id) ?? {};
    const changed: Record<string, StateValue> = {};
    let any = false;
    for (const key in values) {
      if (prev[key] !== values[key]) { changed[key] = values[key]; any = true; }
    }
    if (!any) return;
    this.applied.set(id, { ...prev, ...changed });
    const route = (keys: string[], target: { source: string; sourceLayer?: string; id: string }) => {
      const sub: Record<string, StateValue> = {};
      let has = false;
      for (const key of keys) if (key in changed) { sub[key] = changed[key]; has = true; }
      if (has) this.host.map.setFeatureState(target, sub);
    };
    route(COUNTRY_KEYS, { source: SOURCE.world, sourceLayer: 'countries', id });
    route(PIN_KEYS, { source: SOURCE.points, id });
    if (feature.halo) route(HALO_KEYS, { source: SOURCE.world, sourceLayer: 'halos', id });
  }

  /** Everything the app's Style decides: colours, borders, focus. */
  restyle(focus: ReadonlySet<Feature>): void {
    const style = this.host.style;
    const fallback = style.defaultStroke?.() ?? null;
    this.applyBorder(fallback);
    for (const feature of this.host.world.features) {
      const fill = style.fill(feature);
      const stroke = style.stroke(feature);
      const emphasised = stroke !== null && (!fallback || stroke[0] !== fallback[0] || stroke[1] !== fallback[1]);
      const focused = focus.has(feature);
      this.patch(feature, {
        c: fill ?? TRANSPARENT,
        pc: fill === null ? TRANSPARENT : fill === COLORS.land ? COLORS.microPin : fill,
        sc: emphasised ? stroke[0] : TRANSPARENT,
        sw: emphasised ? stroke[1] : 0,
        fo: style.quizMode && focused ? 2 : focused ? 1 : 0
      });
    }
  }

  private applyBorder(border: [string, number] | null): void {
    if (!border) return;
    const key = `${border[0]}|${border[1]}`;
    if (key === this.lastBorder) return;
    this.lastBorder = key;
    this.host.map.setPaintProperty('borders', 'line-color', border[0]);
    this.host.map.setPaintProperty('borders', 'line-width', border[1]);
  }

  /** Re-reads every palette colour into the static layers (a theme change). */
  applyPalette(): void {
    const border = this.palette().border;
    this.lastBorder = '';
    for (const layer of buildLayers({ border })) {
      if (layer.id === 'pulse' || !('paint' in layer) || !layer.paint) continue;
      for (const [key, value] of Object.entries(layer.paint)) {
        this.host.map.setPaintProperty(layer.id, key as never, value as never);
      }
    }
    this.applied.clear(); // colours changed under every state: write them all again
  }

  /** The capital ring as an image: a dark halo under an ink ring, drawn once per theme. */
  installRingImage(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const radius = CAPITAL_RING_RADIUS;
    const size = Math.ceil((radius + CAPITAL_RING_HALO + 2) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.round(size * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.lineWidth = CAPITAL_RING_HALO * 2;
    ctx.strokeStyle = COLORS.capitalHalo;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS.capital;
    ctx.stroke();
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (this.host.map.hasImage(CAPITAL_RING_IMAGE)) this.host.map.removeImage(CAPITAL_RING_IMAGE);
    this.host.map.addImage(CAPITAL_RING_IMAGE, image, { pixelRatio: ratio });
  }

  /** Each graticule step shows between two zooms, as multiples of the world-fills-the-view zoom. */
  applyGraticuleRanges(): void {
    const home = homeZoom(this.host.viewport);
    if (home === this.graticuleHome) return;
    this.graticuleHome = home;
    const bounds = [0, 3, 10, 30]; // lower edge of each step, x home (30, 10, 5, 1 deg)
    GRATICULE_STEPS.forEach((step, i) => {
      const lo = i === 0 ? -2 : pxToZoom(home * bounds[i]);
      const hi = i === GRATICULE_STEPS.length - 1 ? 24 : pxToZoom(home * bounds[i + 1]);
      this.host.map.setLayerZoomRange(`graticule-${step}`, lo, hi);
    });
  }
}
