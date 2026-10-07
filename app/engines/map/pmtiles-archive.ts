/**
 * world.pmtiles, fetched whole (~3.3 MB) and served to the `pmtiles` protocol from memory.
 *
 * Reading it through many small HTTP range requests made a CDN's Range, ETag or
 * content-encoding handling part of "does the map load"; one plain GET does not. The bytes are
 * checked against `world.pmtiles.json` (length and SHA-256, written by
 * scripts/build/build-tiles.mjs) and against the PMTiles header, so a truncated or stale cached
 * copy is caught here instead of surfacing as a blank map. No maplibre import: unit-testable.
 */
import type { RangeResponse, Source } from 'pmtiles';

import { LoadError } from './load-error';
import { fetchJsonStrict, fetchStrict } from './retry';

export const TILES_URL = '/data/geography/world.pmtiles';
export const TILES_MANIFEST_URL = '/data/geography/world.pmtiles.json';

export interface TilesManifest {
  bytes: number;
  sha256: string;
}

const MAGIC = 'PMTiles';
const HEADER_BYTES = 127;

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');

/** Why `bytes` is not the archive the build wrote, or null when it is. */
export async function validateArchive(bytes: ArrayBuffer, manifest: TilesManifest | null): Promise<string | null> {
  if (bytes.byteLength < HEADER_BYTES) return `only ${bytes.byteLength} bytes, too short for a PMTiles header`;
  const head = new Uint8Array(bytes, 0, MAGIC.length + 1);
  if (String.fromCharCode(...head.subarray(0, MAGIC.length)) !== MAGIC) return 'missing the "PMTiles" magic bytes';
  if (head[MAGIC.length] !== 3) return `unsupported PMTiles version ${head[MAGIC.length]}`;
  if (!manifest) return null;
  if (bytes.byteLength !== manifest.bytes) return `${bytes.byteLength} bytes, expected ${manifest.bytes}`;
  // crypto.subtle needs a secure context; without it the length and header checks stand alone
  const subtle = globalThis.crypto?.subtle;
  if (subtle && hex(await subtle.digest('SHA-256', bytes)) !== manifest.sha256) return 'SHA-256 does not match the build';
  return null;
}

/** A PMTiles Source over bytes already in memory. */
export class MemorySource implements Source {
  constructor(private readonly key: string, private readonly bytes: ArrayBuffer) {}
  getKey(): string {
    return this.key;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: this.bytes.slice(offset, offset + length) };
  }
}

let failedBefore = false;

/** The validated archive. One GET; if the bytes do not validate, one more bypassing every
 *  cache. After any earlier failure the first GET also revalidates. */
export async function fetchArchive(): Promise<ArrayBuffer> {
  try {
    const manifest = await fetchJsonStrict<TilesManifest>('tiles', TILES_MANIFEST_URL, failedBefore ? 2 : 1);
    let reason: string | null = null;
    for (let pass = 0; pass < 2; pass++) {
      const response = await fetchStrict('tiles', TILES_URL, 1, pass === 0 ? (failedBefore ? 'no-cache' : 'default') : 'reload');
      let bytes: ArrayBuffer;
      try {
        bytes = await response.arrayBuffer();
      } catch (cause) {
        throw new LoadError('tiles', `${TILES_URL}: the download was cut short`, { url: TILES_URL, status: response.status, cause });
      }
      reason = await validateArchive(bytes, manifest);
      if (!reason) return bytes;
      console.error(`[map-load] step=tiles url=${TILES_URL} status=${response.status} — invalid tile file (${reason})${pass === 0 ? ', refetching without the cache' : ''}`);
    }
    throw new LoadError('tiles', `${TILES_URL}: invalid tile file (${reason})`, { url: TILES_URL });
  } catch (error) {
    failedBefore = true;
    throw error;
  }
}
