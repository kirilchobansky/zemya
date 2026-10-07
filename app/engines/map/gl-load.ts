/**
 * Waiting for a freshly built MapLibre map to be usable, and deciding which of its errors are
 * fatal. Only two causes are: no WebGL, and the style / tile source metadata failing. A failed
 * tile or glyph request is logged and left to MapLibre, which retries as the camera moves.
 */
import type { Map as GlMap } from 'maplibre-gl';

import { SOURCE } from './gl-style';
import { LoadError } from './load-error';

/** Longest the style's tile source may take to report its metadata before the map counts as failed. */
const SOURCE_TIMEOUT_MS = 20000;

/** The part of MapLibre's `error` event this module reads. */
export interface MapErrorEvent {
  error: ErrorLike;
  sourceId?: string;
  tile?: unknown;
}

interface ErrorLike {
  name?: string;
  message: string;
}

export const isGpuFailure = (error: ErrorLike) => error.name === 'GPUInitializationError' || /webgl/i.test(error.message);

/** A throw while building the map: no WebGL is its own, unretryable, step. */
export function constructionError(error: unknown): LoadError {
  const like = (error ?? {}) as Partial<ErrorLike>;
  const message = like.message ?? String(error);
  return isGpuFailure({ name: like.name, message })
    ? new LoadError('webgl', message, { retryable: false, cause: error })
    : new LoadError('map', message, { cause: error });
}

export function logMapError(e: MapErrorEvent): void {
  const step = isGpuFailure(e.error) ? 'webgl' : 'tiles';
  const what = e.tile ? 'tile' : e.sourceId ? `source ${e.sourceId}` : 'map';
  console.error(`[map-load] step=${step} ${what} — ${e.error.message}`);
}

/** Resolves when the style is in and the tile source knows its metadata; rejects with a
 *  LoadError on a fatal cause. All its listeners are removed once it settles. */
export function whenMapLoaded(map: GlMap): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let styleIn = false;
    const settle = (done: () => void) => {
      clearTimeout(timer);
      map.off('style.load', onStyle);
      map.off('sourcedata', check);
      map.off('error', onError);
      done();
    };
    const check = () => {
      const source = map.getSource(SOURCE.world) as { loaded?: () => boolean } | undefined;
      if (styleIn && source?.loaded?.()) settle(resolve);
    };
    const onStyle = () => { styleIn = true; check(); };
    const onError = (e: MapErrorEvent) => {
      if (isGpuFailure(e.error)) settle(() => reject(constructionError(e.error)));
      else if (e.sourceId === SOURCE.world && !e.tile) {
        settle(() => reject(new LoadError('tiles', `tile source failed: ${e.error.message}`, { cause: e.error })));
      }
    };
    const timer = setTimeout(
      () => settle(() => reject(new LoadError('map', 'the map style did not finish loading in time'))),
      SOURCE_TIMEOUT_MS
    );
    map.on('style.load', onStyle);
    map.on('sourcedata', check);
    map.on('error', onError);
  });
}
