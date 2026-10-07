/**
 * Client-side loader for the map payload.
 *
 * Loads the coarse-geometry payload (world-coarse.json, ~500 KB) alongside the country facts
 * (countries.json, ~220 KB). That is all the client ever fetches for geometry: the map's
 * shapes come from the PMTiles archive (gl-atlas.ts), and the only consumers of this payload
 * are the camera maths, the Outlines quiz silhouette and the size-comparison shape, none of
 * which can show the difference between 1:10m and the coarse simplification (0.006 deg,
 * ~600 m; every polygon is kept, see scripts/build/build-content.mjs). The full 1:10m world.json
 * (~3.4 MB) is a build input for world.pmtiles and is NOT fetched by the app — see
 * docs/performance.md. If a feature ever needs it, fetch it on demand from that feature,
 * cached, never from loadWorld().
 *
 * The fetch is cached on the module, so two components mounting in the same tick share one
 * request rather than doubling up. A failed fetch is retried (engines/map/retry.ts) before it rejects.
 */
import { fetchJsonStrict, withRetry, type RetryInfo } from '~/engines/map/retry';
import { buildWorld } from '~/engines/map/topology';
import type { CountryRecord, GeometryData, World } from '~/engines/map/types';

const COARSE_URL = '/data/geography/world-coarse.json';
const COUNTRIES_URL = '/data/geography/countries.json';

let pending: Promise<World> | null = null;
/** The built world once loadWorld() has resolved — null before. */
let loaded: World | null = null;

/** Whoever asked last to hear about retries (several mounts share the one request). */
let notifyRetry: ((info: RetryInfo) => void) | undefined;

/** Each file is fetched on its own, up to three attempts (retry.ts), so one failing does not refetch the other. */
const fetchData = <T>(url: string) =>
  withRetry('data', attempt => fetchJsonStrict<T>('data', url, attempt), { onRetry: info => notifyRetry?.(info) });

export function loadWorld(onRetry?: (info: RetryInfo) => void): Promise<World> {
  if (onRetry) notifyRetry = onRetry;
  if (!pending) {
    pending = Promise.all([fetchData<GeometryData>(COARSE_URL), fetchData<CountryRecord[]>(COUNTRIES_URL)])
      .then(([coarse, countries]) => {
        const world = buildWorld({ ...coarse, countries });
        loaded = world;
        return world;
      })
      .catch(error => {
        pending = null; // let a later mount retry
        throw error;
      });
  }
  return pending;
}

/** The world if it is already in memory, else null — never starts a fetch. Route clientLoaders
 *  use it to answer from memory (no `.data` round trip); with null they fall back to the
 *  server loader's prerendered data. */
export function peekWorld(): World | null {
  return loaded;
}
