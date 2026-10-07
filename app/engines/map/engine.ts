/**
 * Loads the map renderer on demand: MapLibre GL JS over our own vector tiles (gl-atlas.ts).
 * Imported lazily, so neither MapLibre nor the renderer is in the first page load, and the
 * prerender (which never mounts a map) never evaluates them. The rest of the app talks to the
 * MapController interface (controller.ts) and never to MapLibre.
 */
import type { AtlasCallbacks, MapController } from './controller';
import { withRetry, type RetryHooks } from './retry';
import type { Style } from './style';
import type { World } from './types';

export interface MapEngineModule {
  /** Builds the map in `host` and resolves once its style is in. Up to three attempts, each on
   *  a fresh map (a failed one is destroyed); rejects with a LoadError naming the failed step. */
  create(host: HTMLElement, world: World, callbacks: AtlasCallbacks, style: Style, hooks?: RetryHooks): Promise<MapController>;
}

/** Imports the renderer chunk, retrying. (A browser may remember a failed dynamic import for the
 *  rest of the page's life; the caller reloads once when this still fails — stale-deploy.ts.) */
export async function loadMapEngine(hooks: RetryHooks = {}): Promise<MapEngineModule> {
  const { GlAtlas } = await withRetry('chunk', () => import('./gl-atlas'), hooks);
  return {
    create: (host, world, callbacks, style, createHooks = hooks) =>
      withRetry('map', () => GlAtlas.create(host, world, callbacks, style), createHooks)
  };
}
