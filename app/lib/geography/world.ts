/**
 * Client-side loader for the map payload.
 *
 * Loads the small coarse-geometry payload (world-coarse.json, ~645 KB) alongside the
 * country facts (countries.json, ~175 KB) so the map can paint from well under a
 * megabyte, then fetches the full 1:10m payload (world.json, ~3.4 MB) in the background
 * and attaches it in place once it arrives — see topology.ts's attachFullDetail and
 * CLAUDE.md's Performance section for why there are two payloads and why full detail is
 * still worth the extra download: it's what the map renders once you're zoomed in far
 * enough to actually see it.
 *
 * Both fetches are cached on the module the same way the single fetch used to be, so two
 * components mounting in the same tick share one request each rather than doubling up.
 */
import { attachFullDetail, buildWorld } from '~/lib/map/topology';
import type { CountryRecord, GeometryData, World, WorldData } from '~/lib/map/types';

const COARSE_URL = '/data/geography/world-coarse.json';
const COUNTRIES_URL = '/data/geography/countries.json';
const FULL_URL = '/data/geography/world.json';

let pending: Promise<World> | null = null;
/** The built world once loadWorld() has resolved — null before. */
let loaded: World | null = null;
/** Set once loadWorld()'s promise resolves — onFullDetail reads it to know when it's
 *  safe to attach a "call me once the upgrade lands" listener. */
let fullDetailPromise: Promise<void> | null = null;

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
        fullDetailPromise = fetchJson<WorldData>(FULL_URL)
          .then(data => attachFullDetail(world, data))
          // Losing this upgrade leaves the map at coarse detail forever, which is a
          // worse experience, not a broken one — never let it surface as an unhandled
          // rejection or take the already-painted map down with it.
          .catch(error => console.warn('[world] full-detail payload failed to load', error));
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

/** Runs `cb` once the full-detail payload has attached (or immediately, on a microtask,
 *  if it already had by the time this is called) — the atlas layout uses this to redraw
 *  once geometry it already painted from coarse data gets a full-detail upgrade. A no-op
 *  if loadWorld() hasn't been called yet; there is nothing to upgrade. */
export function onFullDetail(cb: () => void): void {
  fullDetailPromise?.then(cb);
}
