import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoadError } from './load-error';
import { fetchJsonStrict, withRetry } from './retry';

const noSleep = () => Promise.resolve();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('withRetry', () => {
  it('returns the first success without retrying', async () => {
    const run = vi.fn().mockResolvedValue('ok');
    expect(await withRetry('data', run, { sleep: noSleep })).toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries up to three attempts, passing the attempt number', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = vi.fn().mockRejectedValueOnce(new Error('a')).mockRejectedValueOnce(new Error('b')).mockResolvedValue('ok');
    expect(await withRetry('data', run, { sleep: noSleep })).toBe('ok');
    expect(run.mock.calls.map(c => c[0])).toEqual([1, 2, 3]);
  });

  it('gives up after the third failure with a LoadError for the step', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = vi.fn().mockRejectedValue(new Error('nope'));
    const error = await withRetry('chunk', run, { sleep: noSleep }).catch(e => e);
    expect(run).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(LoadError);
    expect(error).toMatchObject({ step: 'chunk', message: 'nope' });
  });

  it('waits 400 ms, then 1200 ms', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sleep = vi.fn(noSleep);
    await withRetry('data', () => Promise.reject(new Error('x')), { sleep }).catch(() => undefined);
    expect(sleep.mock.calls.map(c => c[0])).toEqual([400, 1200]);
  });

  it('does not retry a cause a retry cannot change', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = vi.fn().mockRejectedValue(new LoadError('webgl', 'no webgl', { retryable: false }));
    await expect(withRetry('map', run, { sleep: noSleep })).rejects.toMatchObject({ step: 'webgl' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports each retry and logs each failure with step, url, status and attempt', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onRetry = vi.fn();
    const run = vi.fn()
      .mockRejectedValueOnce(new LoadError('data', 'x: HTTP 503', { url: '/x.json', status: 503 }))
      .mockResolvedValue(1);
    await withRetry('data', run, { sleep: noSleep, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ step: 'data', attempt: 1, attempts: 3 });
    expect(log.mock.calls[0][0]).toContain('step=data attempt=1/3 url=/x.json status=503');
  });

  it('stops retrying once cancelled', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = vi.fn().mockRejectedValue(new Error('x'));
    await withRetry('data', run, { sleep: noSleep, cancelled: () => true }).catch(() => undefined);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('fetchJsonStrict', () => {
  it('revalidates the cache on a retry but not on the first attempt', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{"a":1}')));
    vi.stubGlobal('fetch', fetchMock);
    await fetchJsonStrict('data', '/x.json', 1);
    await fetchJsonStrict('data', '/x.json', 2);
    expect(fetchMock.mock.calls.map(c => c[1].cache)).toEqual(['default', 'no-cache']);
  });

  it('turns an HTTP error, a network error and bad JSON into LoadErrors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    await expect(fetchJsonStrict('data', '/x.json')).rejects.toMatchObject({ step: 'data', status: 503, url: '/x.json' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchJsonStrict('data', '/x.json')).rejects.toMatchObject({ step: 'data', url: '/x.json' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>')));
    await expect(fetchJsonStrict('data', '/x.json')).rejects.toThrow(/not valid JSON/);
  });
});
