/**
 * The history timeline's time axis (scale.ts), second half: ticks, pan/zoom clamping, entry kinds
 * and tier visibility. Conversion, projection and the zoom ladder are in scale.test.ts.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from 'vitest';

import {
  CONFIG, type EntryKind, type HistoryEntry, KIND_RANK, clampCenter, clampPxPerYear, kindRank, maxTierFor, ticks, timeToPx, visibleEntries, type TimeRange, type Viewport, type ZoomLevel
} from './scale';

const viewport = (overrides: Partial<Viewport> = {}): Viewport => ({
  center: 2000, pxPerYear: 10, sizePx: 1000, ...overrides
});

describe('ticks', () => {
  const levelsPresent = (vp: Viewport): Set<ZoomLevel> => new Set(ticks(vp).map(t => t.level));

  it('at millennium zoom, only millennium ticks are active', () => {
    const vp = viewport({ center: 0, pxPerYear: 0.01, sizePx: 800 }); // ~80,000 years wide
    expect(levelsPresent(vp)).toEqual(new Set(['millennium']));
  });

  it('at century zoom, only century ticks are active', () => {
    const vp = viewport({ center: 1000, pxPerYear: 0.2, sizePx: 800 });
    expect(levelsPresent(vp)).toEqual(new Set(['century']));
  });

  it('at decade zoom, only decade ticks are active', () => {
    const vp = viewport({ center: 1000, pxPerYear: 2, sizePx: 800 });
    expect(levelsPresent(vp)).toEqual(new Set(['decade']));
  });

  it('at year zoom, only year ticks are active (no month or day)', () => {
    const vp = viewport({ center: 1900, pxPerYear: 20, sizePx: 800 });
    expect(levelsPresent(vp)).toEqual(new Set(['year']));
  });

  it('at month zoom, year AND month ticks are active together (no day)', () => {
    const vp = viewport({ center: 1900, pxPerYear: 200, sizePx: 800 });
    expect(levelsPresent(vp)).toEqual(new Set(['year', 'month']));
  });

  it('at day zoom, year AND month AND day ticks are all active together', () => {
    const vp = viewport({ center: 1900, pxPerYear: 5000, sizePx: 800 });
    expect(levelsPresent(vp)).toEqual(new Set(['year', 'month', 'day']));
  });

  it('weights year ticks major and month/day ticks minor when combined', () => {
    const vp = viewport({ center: 1900, pxPerYear: 5000, sizePx: 800 });
    const byLevel = new Map(ticks(vp).map(t => [t.level, t.weight]));
    expect(byLevel.get('year')).toBe('major');
    expect(byLevel.get('month')).toBe('minor');
    expect(byLevel.get('day')).toBe('minor');
  });

  it('thins ticks to roughly the target count using one round step, not one per calendar year', () => {
    // 40-year span at "year" level: one tick per year would be 40+, far more than the
    // "6-10 ticks" the layout brief asks for — niceStep should round to a step of 5.
    const vp = viewport({ center: 1900, pxPerYear: 20, sizePx: 800 });
    const years = ticks(vp).map(t => t.t);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(new Set(years).size).toBe(years.length); // no duplicates
    expect(years.length).toBeGreaterThanOrEqual(CONFIG.tickTargetCount - 3);
    expect(years.length).toBeLessThanOrEqual(CONFIG.tickTargetCount + 3);
    const steps = new Set(years.slice(1).map((y, i) => y - years[i]));
    expect(steps.size).toBe(1); // evenly spaced by a single round step
    expect([...steps][0]).toBeGreaterThan(1); // and thinned, not one-per-year
  });

  it('never thins below one tick per calendar year, however small the visible span', () => {
    // At month/day zoom the visible span itself is under a year wide — niceStep would
    // propose a sub-year step there, which must clamp back up to whole years.
    const vp = viewport({ center: 1900, pxPerYear: 5000, sizePx: 800 }); // day zoom
    const yearTicks = ticks(vp).filter(t => t.level === 'year');
    for (const t of yearTicks) expect(Number.isInteger(t.t)).toBe(true);
  });

  it('every tick position matches timeToPx for its own time value', () => {
    const vp = viewport({ center: 1900, pxPerYear: 200, sizePx: 800 });
    for (const tick of ticks(vp)) {
      expect(timeToPx(tick.t, vp)).toBeCloseTo(tick.px, 6);
    }
  });

  it('is sorted by position', () => {
    const vp = viewport({ center: 1900, pxPerYear: 5000, sizePx: 400 });
    const positions = ticks(vp).map(t => t.t);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('clampPxPerYear', () => {
  const range: TimeRange = { from: 650, to: 2026 }; // ~1376-year span

  it('never zooms out further than the range filling the whole viewport', () => {
    const min = 1000 / (range.to - range.from);
    expect(clampPxPerYear(0.001, 1000, range)).toBeCloseTo(min, 9);
  });

  it('never zooms in past CONFIG.maxPxPerYear', () => {
    expect(clampPxPerYear(1e9, 1000, range)).toBe(CONFIG.maxPxPerYear);
  });

  it('passes a value already inside the bounds through unchanged', () => {
    expect(clampPxPerYear(10, 1000, range)).toBe(10);
  });

  it('is a no-op (returns the input) when sizePx is 0 — no viewport to clamp against yet', () => {
    expect(clampPxPerYear(42, 0, range)).toBe(42);
  });
});

describe('clampCenter', () => {
  const range: TimeRange = { from: 650, to: 2026 };

  it('keeps a center already inside the pannable bounds unchanged', () => {
    expect(clampCenter(1900, 10, 1000, range)).toBe(1900); // 50-year visible span, well inside range
  });

  it('clamps toward the range when the visible span would run past its start', () => {
    const pxPerYear = 10; // 100-year visible span
    const result = clampCenter(600, pxPerYear, 1000, range);
    expect(result).toBeGreaterThan(600);
    expect(result - 50).toBeCloseTo(range.from, 9); // left edge sits exactly at range.from
  });

  it('clamps toward the range when the visible span would run past its end', () => {
    const pxPerYear = 10; // 100-year visible span
    const result = clampCenter(2100, pxPerYear, 1000, range);
    expect(result).toBeLessThan(2100);
    expect(result + 50).toBeCloseTo(range.to, 9); // right edge sits exactly at range.to
  });

  it('centers on the range instead of clamping an edge once the viewport is wider than it', () => {
    const pxPerYear = 0.1; // 10,000-year visible span — wider than the whole range
    expect(clampCenter(0, pxPerYear, 1000, range)).toBeCloseTo((range.from + range.to) / 2, 9);
  });
});

describe('kindRank / KIND_RANK', () => {
  it('orders period < ruler < government < event, fixed regardless of content', () => {
    expect(KIND_RANK.period).toBeLessThan(KIND_RANK.ruler);
    expect(KIND_RANK.ruler).toBeLessThan(KIND_RANK.government);
    expect(KIND_RANK.government).toBeLessThan(KIND_RANK.event);
  });

  it('kindRank reads the same table', () => {
    (Object.keys(KIND_RANK) as EntryKind[]).forEach(k => expect(kindRank(k)).toBe(KIND_RANK[k]));
  });
});

describe('maxTierFor', () => {
  it('reads CONFIG.maxTier directly, with no special-cased logic', () => {
    for (const level of Object.keys(CONFIG.maxTier) as ZoomLevel[]) {
      for (const kind of Object.keys(CONFIG.maxTier[level]) as EntryKind[]) {
        expect(maxTierFor(level, kind)).toBe(CONFIG.maxTier[level][kind]);
      }
    }
  });

  it('governments are invisible above decade zoom', () => {
    expect(maxTierFor('millennium', 'government')).toBe(0);
    expect(maxTierFor('century', 'government')).toBe(0);
  });

  it('everything is visible at day zoom, given a permissive enough tier', () => {
    for (const kind of Object.keys(CONFIG.maxTier.day) as EntryKind[]) {
      expect(maxTierFor('day', kind)).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('visibleEntries', () => {
  const entries: HistoryEntry[] = [
    { id: 'in-range-tier1', kind: 'period', tier: 1, start: 1980, end: 2010 },
    { id: 'in-range-tier5', kind: 'event', tier: 5, start: 1995, end: 1995 },
    { id: 'out-of-range', kind: 'period', tier: 1, start: 1500, end: 1600 },
    { id: 'ongoing', kind: 'period', tier: 1, start: 1990, end: null }
  ];

  it('keeps only entries overlapping the overscan range', () => {
    const vp = viewport({ center: 2000, pxPerYear: 20, sizePx: 400 }); // ~2000+-10, overscan widens it
    const ids = visibleEntries(entries, vp).map(e => e.id);
    expect(ids).toContain('in-range-tier1');
    expect(ids).not.toContain('out-of-range');
  });

  it('treats a null end (ongoing) as extending past the visible range', () => {
    const vp = viewport({ center: 2020, pxPerYear: 20, sizePx: 400 });
    const ids = visibleEntries(entries, vp).map(e => e.id);
    expect(ids).toContain('ongoing');
  });

  it('drops an entry whose tier exceeds what this zoom allows', () => {
    // at millennium zoom, event's maxTier is 1 — the tier-5 event must be dropped
    const vp = viewport({ center: 1995, pxPerYear: 0.01, sizePx: 800 });
    const ids = visibleEntries(entries, vp).map(e => e.id);
    expect(ids).not.toContain('in-range-tier5');
  });

  it('drops a kind whose maxTier is 0 at this level entirely', () => {
    const govEntries: HistoryEntry[] = [{ id: 'gov', kind: 'government', tier: 1, start: 2000, end: 2005 }];
    const vp = viewport({ center: 2000, pxPerYear: 0.01, sizePx: 800 }); // millennium: government maxTier = 0
    expect(visibleEntries(govEntries, vp)).toHaveLength(0);
  });

  it('sorts by kindRank first, start second — order never depends on input order', () => {
    const mixed: HistoryEntry[] = [
      { id: 'event-early', kind: 'event', tier: 1, start: 1990, end: 1990 },
      { id: 'period-late', kind: 'period', tier: 1, start: 1995, end: 2000 },
      { id: 'ruler-mid', kind: 'ruler', tier: 1, start: 1992, end: 1993 },
      { id: 'period-early', kind: 'period', tier: 1, start: 1980, end: 1985 }
    ];
    const vp = viewport({ center: 1990, pxPerYear: 5, sizePx: 2000 });
    const ids = visibleEntries(mixed, vp).map(e => e.id);
    expect(ids).toEqual(['period-early', 'period-late', 'ruler-mid', 'event-early']);
  });

  it('keeps ordering stable independent of array input order (fixed rank, not first-seen)', () => {
    const vp = viewport({ center: 1990, pxPerYear: 5, sizePx: 2000 });
    const a = visibleEntries(entries, vp).map(e => e.id);
    const b = visibleEntries([...entries].reverse(), vp).map(e => e.id);
    expect(b).toEqual(a);
  });
});
