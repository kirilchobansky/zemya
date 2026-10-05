/**
 * What the rest of the app may ask of the map. One interface, whichever renderer sits behind
 * it (the engine switch is app/lib/map/engine.ts): quizzes, the country pages and the atlas
 * shell talk to a MapController and never to MapLibre or a canvas.
 */
import type { Insets } from './camera';
import type { Style } from './style';
import type { Feature, PlaceMark } from './types';

export interface AtlasCallbacks {
  /** `place` is set when the pointer is over a capital's ring — `feature` is then that
   *  capital's country, so hovering a ring also lights up its country. `x`, `y` are the screen
   *  position of the country's label point (or the ring), never the pointer; `labelShown` is
   *  whether its name is already on the map. */
  onHover(feature: Feature | null, x: number, y: number, place?: PlaceMark | null, labelShown?: boolean): void;
  onSelect(feature: Feature | null): void;
  onCameraChange?(scale: { km: number; px: number }): void;
  onCompareMove?(feature: Feature, over: Feature | null): void;
}

export interface MapController {
  /** Restyle: colours, borders, which layers are on. Cheap — never touches geometry. */
  setStyle(style: Style): void;
  /** Marks features for a bigger pin; the quiz target stays findable at the world view. */
  setFocus(features: Iterable<Feature>): void;
  /** During a quiz run the map must not take focus (the answer input keeps the keyboard). */
  setKeepFocus(keep: boolean): void;
  setUiFont(font: string): void;
  /** Repaint after the world's own data changed (full-detail payload) or the theme did. */
  redraw(): void;
  /** [minLon, minLat, maxLon, maxLat] a continent quiz treats as home, or null for the world. */
  setRegionView(box: [number, number, number, number] | null): void;
  /** What covers the map (phone sheet, tab bar, quiz HUD): subtracted wherever it frames. */
  setInsets(insets: Insets): void;
  home(animate?: boolean): void;
  zoomBy(factor: number): void;
  flyTo(feature: Feature, padding?: number): void;
  /** A quiz question changed: put the player where they can see its target (one decision). */
  followTarget(request: { feature: Feature; place?: PlaceMark | null }, insets: Insets): void;
  /** A one-shot ring on a new quiz target, in map space (unit square). */
  pulse(ux: number, uy: number): void;
  readonly view: { x: number; y: number; zoom: number; home: number };
  screenPosition(ux: number, uy: number): [number, number];
  fit(features: Feature[], padding?: number): void;
  startCompare(feature: Feature): boolean;
  stopCompare(): void;
  readonly comparing: Feature | null;
  readonly scale: { km: number; px: number };
  destroy(): void;
}
