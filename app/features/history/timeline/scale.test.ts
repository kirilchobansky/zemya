/**
 * The history timeline's time axis (scale.ts), first half: decimal-year conversion, viewport
 * projection and the zoom ladder. Ticks, clamping and tier visibility are in scale-ticks.test.ts.
 * Pure logic, checked directly — no canvas, no React, no build.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from 'vitest';

import {
  CONFIG, dateOfDecimalYear, decimalYearOf, decimalYearOfDate, levelFor, pxToTime, timeToPx, visibleRange, visibleRangeOverscan
} from './scale';

const viewport = (overrides: Partial<Viewport> = {}): Viewport => ({
  center: 2000, pxPerYear: 10, sizePx: 1000, ...overrides
});

describe('timeToPx / pxToTime', () => {
  it('are exact inverses at millennium zoom (tiny pxPerYear)', () => {
    const vp = viewport({ center: 0, pxPerYear: 0.01, sizePx: 800 });
    for (const t of [-5000, -1, 0, 1, 3000.5]) {
      expect(pxToTime(timeToPx(t, vp), vp)).toBeCloseTo(t, 9);
    }
  });

  it('are exact inverses at day zoom (huge pxPerYear)', () => {
    const vp = viewport({ center: 1878.17, pxPerYear: 3000, sizePx: 1200 });
    for (const t of [1878, 1878.17, 1878.5, 1879]) {
      expect(pxToTime(timeToPx(t, vp), vp)).toBeCloseTo(t, 9);
    }
  });

  it('places the centre at the middle pixel', () => {
    const vp = viewport({ center: 1500, pxPerYear: 4, sizePx: 1000 });
    expect(timeToPx(1500, vp)).toBe(500);
  });

  it('does not care whether the axis is thought of as horizontal or vertical — same maths either way', () => {
    const vp = viewport({ center: 500, pxPerYear: 2, sizePx: 600 }); // could equally be a height
    expect(pxToTime(timeToPx(499, vp), vp)).toBeCloseTo(499, 9);
  });
});

describe('visibleRange / visibleRangeOverscan', () => {
  it('spans exactly sizePx / pxPerYear years, centred on viewport.center', () => {
    const vp = viewport({ center: 2000, pxPerYear: 10, sizePx: 1000 }); // 100 years wide
    const r = visibleRange(vp);
    expect(r.from).toBeCloseTo(1950, 9);
    expect(r.to).toBeCloseTo(2050, 9);
  });

  it('widens symmetrically by the given factor around the SAME centre', () => {
    const vp = viewport({ center: 2000, pxPerYear: 10, sizePx: 1000 });
    const r = visibleRangeOverscan(vp, 2);
    expect(r.to - r.from).toBeCloseTo(200, 9); // 2x the 100-year visible span
    expect((r.from + r.to) / 2).toBeCloseTo(2000, 9);
  });

  it('defaults to CONFIG.overscanFactor', () => {
    const vp = viewport({ center: 2000, pxPerYear: 10, sizePx: 1000 });
    const r = visibleRangeOverscan(vp);
    expect(r.to - r.from).toBeCloseTo(100 * CONFIG.overscanFactor, 9);
  });
});

describe('decimalYearOfDate / dateOfDecimalYear', () => {
  it('round-trips a year-only date', () => {
    const d = { year: 681, month: null, day: null };
    expect(dateOfDecimalYear(decimalYearOfDate(d))).toEqual({ raw: '681', year: 681, month: null, day: null });
  });

  it('round-trips a full date', () => {
    const d = { year: 811, month: 7, day: 26 };
    expect(dateOfDecimalYear(decimalYearOfDate(d))).toEqual({ raw: '811-07-26', year: 811, month: 7, day: 26 });
  });

  it('round-trips a negative (BC) year-only date', () => {
    const d = { year: -450, month: null, day: null };
    expect(dateOfDecimalYear(decimalYearOfDate(d))).toEqual({ raw: '-450', year: -450, month: null, day: null });
  });

  it('round-trips a negative (BC) full date', () => {
    const d = { year: -450, month: 3, day: 1 };
    expect(dateOfDecimalYear(decimalYearOfDate(d))).toEqual({ raw: '-450-03-01', year: -450, month: 3, day: 1 });
  });

  it('orders a BC date before an AD one', () => {
    expect(decimalYearOfDate({ year: -1, month: null, day: null })).toBeLessThan(
      decimalYearOfDate({ year: 1, month: null, day: null })
    );
  });

  it('decimalYearOf parses the raw authored string directly, sharing scripts/lib/history.mjs\'s parser', () => {
    expect(decimalYearOf('681')).toBe(681);
    expect(decimalYearOf('-450')).toBe(-450);
  });

  it('a January-1st date is exactly the fractional start of its year, strictly after the year-only value', () => {
    const yearOnly = decimalYearOfDate({ year: 1878, month: null, day: null });
    const jan2 = decimalYearOfDate({ year: 1878, month: 1, day: 2 });
    expect(jan2).toBeGreaterThan(yearOnly);
    expect(jan2).toBeLessThan(1879);
  });
});

describe('levelFor', () => {
  it('returns millennium at the very bottom of the scale', () => {
    expect(levelFor(0)).toBe('millennium');
    expect(levelFor(0.01)).toBe('millennium');
  });

  it('returns day at the very top of the scale', () => {
    expect(levelFor(100000)).toBe('day');
  });

  it('picks exactly the level whose threshold is met, for every configured threshold', () => {
    for (const { level, minPxPerYear } of CONFIG.zoomThresholds) {
      expect(levelFor(minPxPerYear)).toBe(level);
    }
  });

  it('stays at the coarser level just below a threshold', () => {
    const monthThreshold = CONFIG.zoomThresholds.find(z => z.level === 'month')!.minPxPerYear;
    expect(levelFor(monthThreshold - 0.001)).toBe('year');
  });
});
