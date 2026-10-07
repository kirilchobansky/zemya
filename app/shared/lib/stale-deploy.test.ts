import { afterEach, describe, expect, it, vi } from 'vitest';

import { reloadOnce } from './stale-deploy';

function stubStorage(store: Record<string, string> | 'throws') {
  vi.stubGlobal('window', {
    sessionStorage: store === 'throws'
      ? { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } }
      : { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } }
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('reloadOnce', () => {
  it('reloads the first time and not again within the minute', () => {
    stubStorage({});
    const reload = vi.fn();
    expect(reloadOnce(reload)).toBe(true);
    expect(reloadOnce(reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads again once a minute has passed', () => {
    stubStorage({ 'zemya:stale-reload': String(Date.now() - 61_000) });
    const reload = vi.fn();
    expect(reloadOnce(reload)).toBe(true);
  });

  it('never reloads when storage is unavailable, so it cannot loop', () => {
    stubStorage('throws');
    const reload = vi.fn();
    expect(reloadOnce(reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
