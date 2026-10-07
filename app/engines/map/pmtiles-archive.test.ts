import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchArchive, MemorySource, TILES_MANIFEST_URL, TILES_URL, validateArchive } from './pmtiles-archive';

/** A buffer that passes the header checks: "PMTiles", version 3, then filler. */
function archive(size = 300, fill = 7): ArrayBuffer {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set([...'PMTiles'].map(c => c.charCodeAt(0)), 0);
  bytes[7] = 3;
  return bytes.buffer;
}
const manifestOf = (buf: ArrayBuffer) => ({
  bytes: buf.byteLength,
  sha256: createHash('sha256').update(new Uint8Array(buf)).digest('hex')
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('validateArchive', () => {
  it('accepts the archive the manifest describes', async () => {
    const good = archive();
    expect(await validateArchive(good, manifestOf(good))).toBeNull();
  });

  it('rejects missing magic bytes, a wrong version and a truncated file', async () => {
    const noMagic = new Uint8Array(archive());
    noMagic[0] = 0x3c; // "<html>…" from a CDN error page
    expect(await validateArchive(noMagic.buffer, null)).toMatch(/magic/);
    const v2 = new Uint8Array(archive());
    v2[7] = 2;
    expect(await validateArchive(v2.buffer, null)).toMatch(/version 2/);
    expect(await validateArchive(new ArrayBuffer(40), null)).toMatch(/too short/);
  });

  it('rejects a wrong length and a wrong hash', async () => {
    const good = archive();
    expect(await validateArchive(good.slice(0, 200), manifestOf(good))).toMatch(/200 bytes, expected 300/);
    expect(await validateArchive(archive(300, 9), manifestOf(good))).toMatch(/SHA-256/);
  });
});

describe('MemorySource', () => {
  it('answers a byte range from memory', async () => {
    const source = new MemorySource('k', Uint8Array.from([1, 2, 3, 4, 5]).buffer);
    expect(source.getKey()).toBe('k');
    expect(Array.from(new Uint8Array((await source.getBytes(1, 3)).data))).toEqual([2, 3, 4]);
    expect((await source.getBytes(3, 100)).data.byteLength).toBe(2);
  });
});

describe('fetchArchive', () => {
  const stub = (answers: Record<string, () => Response>) => {
    const fetchMock = vi.fn((url: string) => Promise.resolve(answers[url]()));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('downloads the whole file once when it is valid', async () => {
    const good = archive();
    const fetchMock = stub({
      [TILES_MANIFEST_URL]: () => new Response(JSON.stringify(manifestOf(good))),
      [TILES_URL]: () => new Response(good.slice(0))
    });
    expect((await fetchArchive()).byteLength).toBe(300);
    expect(fetchMock.mock.calls.filter(c => c[0] === TILES_URL)).toHaveLength(1);
    expect(fetchMock.mock.calls.some(c => c[1]?.headers?.Range)).toBe(false);
  });

  it('refetches once, bypassing the cache, when the first copy is corrupt', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = archive();
    let calls = 0;
    const fetchMock = stub({
      [TILES_MANIFEST_URL]: () => new Response(JSON.stringify(manifestOf(good))),
      [TILES_URL]: () => new Response(++calls === 1 ? good.slice(0, 100) : good.slice(0))
    });
    expect((await fetchArchive()).byteLength).toBe(300);
    const tileCalls = fetchMock.mock.calls.filter(c => c[0] === TILES_URL);
    expect(tileCalls).toHaveLength(2);
    expect(tileCalls[1][1].cache).toBe('reload');
  });

  it('fails with a tiles LoadError when the refetch is corrupt too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = archive();
    stub({
      [TILES_MANIFEST_URL]: () => new Response(JSON.stringify(manifestOf(good))),
      [TILES_URL]: () => new Response(good.slice(0, 100))
    });
    await expect(fetchArchive()).rejects.toMatchObject({ step: 'tiles', url: TILES_URL });
  });
});
