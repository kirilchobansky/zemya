/**
 * Client-side loader for the map payload.
 *
 * Loads the coarse-geometry payload (world-coarse.json, ~500 KB) alongside the country facts
 * (countries.json, ~220 KB). That is all the client ever fetches for geometry: the map's
 * shapes come from the PMTiles archive (gl-atlas.ts), and the only consumers of this payload
 * are the camera maths, the Outlines quiz silhouette and the size-comparison shape, none of
 * which can show the difference between 1:10m and the coarse simplification (0.006 deg,
 * ~600 m; every polygon is kept, see scripts/build-content.mjs). The full 1:10m world.json
 * (~3.4 MB) is a build input for world.pmtiles and is NOT fetched by the app — see
 * docs/performance.md. If a feature ever needs it, fetch it on demand from that feature,
 * cached, never from loadWorld().
 *
 * The fetch is cached on the module, so two components mounting in the same tick share one
 * request rather than doubling up.
 */
import { buildWorld } from '~/lib/map/topology';
import type { CountryRecord, GeometryData, World } from '~/lib/map/types';

const COARSE_URL = '/data/geography/world-coarse.json';
const COUNTRIES_URL = '/data/geography/countries.json';

let pending: Promise<World> | null = null;
/** The built world once loadWorld() has resolved — null before. */
let loaded: World | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json() as Promise<T>;
}

export function loadWorld(): Promise<World> {
  if (!pending) {
    pending = Promise.all([fetchJson<GeometryData>(COARSE_URL), fetchJson<CountryRecord[]>(COUNTRIES_URL)])
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
