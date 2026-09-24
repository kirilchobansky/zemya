/**
 * Date parsing and validation for content/history/*.yaml (scripts/lib/history.mjs).
 * Plain-logic tests, same spirit as scheduler.test.ts and mastery.test.ts — no build, no
 * browser.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from 'vitest';

// scripts/lib/history.mjs is plain Node ESM (the build runs outside Vite/TS), imported
// here by relative path rather than through the `~` alias vitest.config.ts sets up for
// app/ — that alias only covers app/lib.
import { dateKey, parseHistoryDate, validateHistory } from '../../scripts/lib/history.mjs';

const base = {
  kind: 'event',
  name: { bg: 'Тест', en: 'Test' },
  precision: 'year',
  style: 'new',
  tier: 1,
  start: '2000'
};

describe('parseHistoryDate', () => {
  it('parses a plain year', () => {
    expect(parseHistoryDate('681', 'x')).toEqual({ raw: '681', year: 681, month: null, day: null });
  });

  it('parses a negative (BC) year', () => {
    expect(parseHistoryDate('-450', 'x')).toEqual({ raw: '-450', year: -450, month: null, day: null });
  });

  it('parses a full date', () => {
    expect(parseHistoryDate('811-07-26', 'x')).toEqual({ raw: '811-07-26', year: 811, month: 7, day: 26 });
  });

  it('parses a full negative-year date', () => {
    expect(parseHistoryDate('-450-03-01', 'x')).toEqual({ raw: '-450-03-01', year: -450, month: 3, day: 1 });
  });

  it('rejects an unparseable string', () => {
    expect(() => parseHistoryDate('circa 681', 'x')).toThrow(/not a valid date/);
  });

  it('rejects an out-of-range month', () => {
    expect(() => parseHistoryDate('2000-13-01', 'x')).toThrow(/invalid month/);
  });

  it('rejects an out-of-range day', () => {
    expect(() => parseHistoryDate('2000-01-32', 'x')).toThrow(/invalid day/);
  });
});

describe('dateKey', () => {
  it('orders year-only dates by year', () => {
    expect(dateKey(parseHistoryDate('681', 'x'))).toBeLessThan(dateKey(parseHistoryDate('1018', 'x')));
  });

  it('orders a negative year before a positive one', () => {
    expect(dateKey(parseHistoryDate('-450', 'x'))).toBeLessThan(dateKey(parseHistoryDate('1', 'x')));
  });

  it('breaks ties within the same year by month and day', () => {
    expect(dateKey(parseHistoryDate('1878-03-03', 'x'))).toBeLessThan(dateKey(parseHistoryDate('1878-07-13', 'x')));
  });

  it('treats a year-only date as earlier than any dated point in the same year', () => {
    // month/day default to the start of the year, so "1878" sorts before "1878-01-02"
    expect(dateKey(parseHistoryDate('1878', 'x'))).toBeLessThan(dateKey(parseHistoryDate('1878-01-02', 'x')));
  });
});

describe('validateHistory', () => {
  it('accepts a minimal well-formed file', () => {
    const built = validateHistory({ entries: [{ ...base, id: 'a' }] }, 'x');
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ id: 'a', startYear: 2000, endYear: null, end: null });
  });

  it('fills in defaults for aliases, role, parent and en text', () => {
    const built = validateHistory({ entries: [{ ...base, id: 'a' }] }, 'x');
    expect(built[0]).toMatchObject({
      aliases: [], role: null, parent: null, blurb: { bg: '', en: '' }
    });
  });

  it('throws on a duplicate id', () => {
    const entries = [{ ...base, id: 'dup' }, { ...base, id: 'dup' }];
    expect(() => validateHistory({ entries }, 'x')).toThrow(/duplicate id "dup"/);
  });

  it('throws when end is before start', () => {
    const entries = [{ ...base, id: 'a', start: '1018', end: '681' }];
    expect(() => validateHistory({ entries }, 'x')).toThrow(/end \(681\) is before start \(1018\)/);
  });

  it('accepts end equal to start (a single-day event)', () => {
    const entries = [{ ...base, id: 'a', start: '766', end: '766' }];
    expect(() => validateHistory({ entries }, 'x')).not.toThrow();
  });

  it('throws on an unknown parent', () => {
    const entries = [{ ...base, id: 'a', parent: 'ghost' }];
    expect(() => validateHistory({ entries }, 'x')).toThrow(/unknown parent "ghost"/);
  });

  it('accepts a parent that is defined earlier in the same file', () => {
    const entries = [{ ...base, id: 'parent' }, { ...base, id: 'child', parent: 'parent' }];
    expect(() => validateHistory({ entries }, 'x')).not.toThrow();
  });

  it('accepts a parent that is defined later in the same file', () => {
    const entries = [{ ...base, id: 'child', parent: 'parent' }, { ...base, id: 'parent' }];
    expect(() => validateHistory({ entries }, 'x')).not.toThrow();
  });

  it('throws on a missing tier', () => {
    const { tier, ...withoutTier } = base;
    expect(() => validateHistory({ entries: [{ ...withoutTier, id: 'a' }] }, 'x')).toThrow(/missing or non-integer "tier"/);
  });

  it('throws on a tier outside 1..5', () => {
    const entries = [{ ...base, id: 'a', tier: 6 }];
    expect(() => validateHistory({ entries }, 'x')).toThrow(/"tier" must be 1\.\.5/);
  });

  it('throws on a missing name.bg', () => {
    const entries = [{ ...base, id: 'a', name: { bg: '', en: 'Test' } }];
    expect(() => validateHistory({ entries }, 'x')).toThrow(/missing "name.bg"/);
  });

  it('throws on an unrecognised kind', () => {
    const entries = [{ ...base, id: 'a', kind: 'dynasty' }];
    expect(() => validateHistory({ entries }, 'x')).toThrow(/"kind" must be one of/);
  });

  it('throws on an unrecognised precision', () => {
    const entries = [{ ...base, id: 'a', precision: 'ish' }];
    expect(() => validateHistory({ entries }, 'x')).toThrow(/"precision" must be one of/);
  });

  it('throws on an unrecognised style', () => {
    const entries = [{ ...base, id: 'a', style: 'julian' }];
    expect(() => validateHistory({ entries }, 'x')).toThrow(/"style" must be one of/);
  });

  it('throws when entries is missing entirely', () => {
    expect(() => validateHistory({}, 'x')).toThrow(/expected a top-level "entries" list/);
  });
});
