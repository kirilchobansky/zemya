/**
 * Which renderer draws the map — ONE constant, so the two can be compared side by side and the
 * old one deleted in a single step once the new one has parity.
 *
 *   'gl'      MapLibre GL JS over our own vector tiles (gl-atlas.ts). WebGL: sharp at any zoom.
 *   'canvas'  the original Canvas 2D renderer (atlas.ts / renderer.ts). To be removed.
 *
 * Both implement MapController (controller.ts); the rest of the app never knows which it has.
 * The renderers are imported lazily, so neither the engine's code nor MapLibre is in the first
 * page load, and the prerender (which never mounts a map) never evaluates them.
 */
import type { AtlasCallbacks, MapController } from './controller';
import type { Style } from './style';
import type { World } from './types';

export type MapEngine = 'gl' | 'canvas';
export const MAP_ENGINE: MapEngine = 'gl';

export interface MapEngineModule {
  /** Builds the controller on `host` — a <div> for 'gl', a <canvas> for 'canvas'. */
  create(host: HTMLElement, world: World, callbacks: AtlasCallbacks, style: Style): Promise<MapController>;
}

export async function loadMapEngine(): Promise<MapEngineModule> {
  if (MAP_ENGINE === 'gl') {
    const { GlAtlas } = await import('./gl-atlas');
    return { create: (host, world, callbacks, style) => GlAtlas.create(host, world, callbacks, style) };
  }
  const { Atlas } = await import('./atlas');
  return { create: async (host, world, callbacks, style) => new Atlas(host as HTMLCanvasElement, world, callbacks, style) };
}
