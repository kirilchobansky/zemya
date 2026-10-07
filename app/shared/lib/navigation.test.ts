import { describe, expect, it } from 'vitest';

import { isCurrentUrl } from './navigation';

describe('isCurrentUrl', () => {
  it('matches the same path, with or without the same query', () => {
    expect(isCurrentUrl('/country/chile', '/country/chile')).toBe(true);
    expect(isCurrentUrl('/a?order=population', '/a?order=population')).toBe(true);
  });
  it('does not match another place, query or hash', () => {
    expect(isCurrentUrl('/country/peru', '/country/chile')).toBe(false);
    expect(isCurrentUrl('/a', '/a?order=population')).toBe(false);
    expect(isCurrentUrl('/a#x', '/a')).toBe(false);
  });
});
