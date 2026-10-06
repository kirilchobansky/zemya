/**
 * Loads the map renderer on demand: MapLibre GL JS over our own vector tiles (gl-atlas.ts).
 * Imported lazily, so neither MapLibre nor the renderer is in the first page load, and the
 * prerender (which never mounts a map) never evaluates them. The rest of the app talks to the
 * MapController interface (controller.ts) and never to MapLibre.
 */
import type { AtlasCallbacks, MapController } from './controller';
import type { Style } from './style';
import type { World } from './types';

export interface MapEngineModule {
  /** Builds the map in `host` and resolves once its style is in. */
  create(host: HTMLElement, world: World, callbacks: AtlasCallbacks, style: Style): Promise<MapController>;
}

export async function loadMapEngine(): Promise<MapEngineModule> {
  const { GlAtlas } = await import('./gl-atlas');
  return { create: (host, world, callbacks, style) => GlAtlas.create(host, world, callbacks, style) };
}
