/**
 * Client-side loader for the map payload.
 *
 * Fetched once and memoised on the module. The promise is cached rather than the result
 * so that two components mounting in the same tick share one request.
 */
import { buildWorld } from '~/lib/map/topology';
import type { World, WorldData } from '~/lib/map/types';

const WORLD_URL = '/data/geography/world.json';

let pending: Promise<World> | null = null;

export function loadWorld(): Promise<World> {
  if (!pending) {
    pending = fetch(WORLD_URL)
      .then(response => {
        if (!response.ok) throw new Error(`world.json: ${response.status}`);
        return response.json() as Promise<WorldData>;
      })
      .then(buildWorld)
      .catch(error => {
        pending = null;              // let a later mount retry
        throw error;
      });
  }
  return pending;
}
