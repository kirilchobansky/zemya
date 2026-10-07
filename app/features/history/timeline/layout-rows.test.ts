/**
 * Layout logic for the history timeline (layout.ts), second half: row packing, density buckets and
 * label collision. The context stack and bar/pinned classification are in layout.test.ts.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from 'vitest';

import { assignRows, densityBuckets, type LabelCandidate, type LayoutEntry, placeLabels } from './layout';
import { timeToPx, type Viewport } from './scale';

const entry = (over: Partial<LayoutEntry> & Pick<LayoutEntry, 'id' | 'kind' | 'start'>): LayoutEntry => ({
  tier: 1, end: null, parent: null, ...over
});

const viewport = (over: Partial<Viewport> = {}): Viewport => ({ center: 2000, pxPerYear: 10, sizePx: 1000, ...over });

describe('assignRows', () => {
  it('gives non-overlapping same-kind entries the same row (row 0)', () => {
    const rows = assignRows([
      entry({ id: 'a', kind: 'ruler', start: 700, end: 720 }),
      entry({ id: 'b', kind: 'ruler', start: 720, end: 740 })
    ]);
    expect(rows.get('a')).toBe(0);
    expect(rows.get('b')).toBe(0);
  });

  it('puts overlapping same-kind entries (co-rulers) in different rows', () => {
    const rows = assignRows([
      entry({ id: 'a', kind: 'ruler', start: 700, end: 750 }),
      entry({ id: 'b', kind: 'ruler', start: 710, end: 730 })
    ]);
    expect(rows.get('a')).not.toBe(rows.get('b'));
  });

  it('packs three mutually-overlapping entries into three distinct rows', () => {
    const rows = assignRows([
      entry({ id: 'a', kind: 'period', start: 1990, end: 2020 }),
      entry({ id: 'b', kind: 'period', start: 1995, end: 2015 }),
      entry({ id: 'c', kind: 'period', start: 2000, end: 2010 })
    ]);
    const values = new Set([rows.get('a'), rows.get('b'), rows.get('c')]);
    expect(values.size).toBe(3);
  });

  it('reuses a freed row once its previous occupant has ended', () => {
    const rows = assignRows([
      entry({ id: 'a', kind: 'ruler', start: 700, end: 710 }),
      entry({ id: 'b', kind: 'ruler', start: 705, end: 715 }), // overlaps a -> row 1
      entry({ id: 'c', kind: 'ruler', start: 712, end: 720 })  // a's row (0) is free again by 712
    ]);
    expect(rows.get('a')).toBe(0);
    expect(rows.get('b')).toBe(1);
    expect(rows.get('c')).toBe(0);
  });

  it('numbers rows independently per kind', () => {
    const rows = assignRows([
      entry({ id: 'p1', kind: 'period', start: 1990, end: 2020 }),
      entry({ id: 'p2', kind: 'period', start: 1995, end: 2015 }), // overlaps p1 -> row 1
      entry({ id: 'g1', kind: 'government', start: 1990, end: 2020 })
    ]);
    expect(rows.get('g1')).toBe(0); // not pushed to row 1 by the unrelated "period" collision
  });

  it('is deterministic: the same input always assigns the same rows', () => {
    const entries = [
      entry({ id: 'a', kind: 'ruler', start: 700, end: 750 }),
      entry({ id: 'b', kind: 'ruler', start: 710, end: 730 }),
      entry({ id: 'c', kind: 'ruler', start: 705, end: 715 })
    ];
    const first = assignRows(entries);
    const second = assignRows(entries);
    for (const e of entries) expect(second.get(e.id)).toBe(first.get(e.id));
  });

  it('gives the same row assignment regardless of viewport — it never takes one', () => {
    // assignRows has no viewport parameter at all; this test documents/enforces that by
    // construction (a TS compile error here would mean the contract changed).
    const entries = [
      entry({ id: 'a', kind: 'ruler', start: 700, end: 750 }),
      entry({ id: 'b', kind: 'ruler', start: 710, end: 730 })
    ];
    const rowsA = assignRows(entries);
    const rowsB = assignRows(entries); // "panning" changes nothing since no viewport is involved
    expect(rowsB).toEqual(rowsA);
  });
});

describe('densityBuckets', () => {
  it('returns all zeros when nothing is hidden at this zoom', () => {
    const vp = viewport({ center: 2000, pxPerYear: 0.01, sizePx: 800 }); // millennium zoom
    const entries = [entry({ id: 'e', kind: 'event', tier: 1, start: 2000, end: 2000 })]; // tier 1 IS visible at millennium
    expect(densityBuckets(entries, vp, 4)).toEqual([0, 0, 0, 0]);
  });

  it('counts an entry hidden by tier at this zoom into its bucket', () => {
    const vp = viewport({ center: 2000, pxPerYear: 0.01, sizePx: 800 }); // millennium zoom: ruler maxTier is 0
    const entries = [entry({ id: 'r', kind: 'ruler', tier: 1, start: 2000, end: 2000 })];
    const buckets = densityBuckets(entries, vp, 4);
    expect(buckets.some(b => b > 0)).toBe(true);
  });

  it('does NOT count an entry that is already visible at this zoom (not "hidden")', () => {
    const vp = viewport({ center: 2000, pxPerYear: 5000, sizePx: 800 }); // day zoom: everything visible
    const entries = [entry({ id: 'r', kind: 'ruler', tier: 1, start: 2000, end: 2000 })];
    expect(densityBuckets(entries, vp, 4)).toEqual([0, 0, 0, 0]);
  });

  it('ignores an entry entirely outside the visible range', () => {
    const vp = viewport({ center: 2000, pxPerYear: 20, sizePx: 400 }); // ~1990..2010
    const entries = [entry({ id: 'r', kind: 'ruler', tier: 1, start: 500, end: 500 })];
    expect(densityBuckets(entries, vp, 4)).toEqual([0, 0, 0, 0]);
  });

  it('places a hidden entry into the bucket matching its position, normalised to 1', () => {
    const vp = viewport({ center: 2000, pxPerYear: 10, sizePx: 1000 }); // 1950..2050, 100 years, 4 buckets of 25y — level "year"
    // tier 5 is below the "year" level's ruler ceiling (3), so it counts as hidden here
    const entries = [entry({ id: 'r', kind: 'ruler', tier: 5, start: 1955, end: 1955 })]; // in bucket 0
    const buckets = densityBuckets(entries, vp, 4);
    expect(buckets[0]).toBe(1);
    expect(buckets.slice(1)).toEqual([0, 0, 0]);
  });

  it('normalises relative to the busiest bucket', () => {
    const vp = viewport({ center: 2000, pxPerYear: 10, sizePx: 1000 }); // 1950..2050, 4 buckets of 25y
    const entries = [
      entry({ id: 'r1', kind: 'ruler', tier: 5, start: 1955, end: 1955 }),
      entry({ id: 'r2', kind: 'ruler', tier: 5, start: 1956, end: 1956 }), // same bucket as r1
      entry({ id: 'r3', kind: 'ruler', tier: 5, start: 2030, end: 2030 })  // a different bucket
    ];
    const buckets = densityBuckets(entries, vp, 4);
    expect(Math.max(...buckets)).toBe(1);
    expect(buckets[0]).toBe(1); // the busiest bucket (2 entries)
    expect(buckets.some(b => b > 0 && b < 1)).toBe(true); // the other bucket is scaled down, not zero
  });

  it('returns an empty array for a non-positive bucket count', () => {
    expect(densityBuckets([], viewport(), 0)).toEqual([]);
  });
});

describe('placeLabels', () => {
  const cand = (over: Partial<LabelCandidate> & Pick<LabelCandidate, 'id' | 'px'>): LabelCandidate => ({
    widthPx: 40, tier: 1, ...over
  });

  it('keeps all candidates when none overlap', () => {
    const result = placeLabels([cand({ id: 'a', px: 0 }), cand({ id: 'b', px: 100 })]);
    expect(result.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('drops the worse-tier label when two candidates overlap', () => {
    const result = placeLabels([
      cand({ id: 'major', px: 0, widthPx: 60, tier: 1 }),
      cand({ id: 'minor', px: 20, widthPx: 60, tier: 3 })
    ]);
    expect(result.map(r => r.id)).toEqual(['major']);
  });

  it('keeps the better-tier label regardless of input order', () => {
    const a = cand({ id: 'major', px: 0, widthPx: 60, tier: 1 });
    const b = cand({ id: 'minor', px: 20, widthPx: 60, tier: 3 });
    expect(placeLabels([a, b]).map(r => r.id)).toEqual(['major']);
    expect(placeLabels([b, a]).map(r => r.id)).toEqual(['major']);
  });

  it('breaks an exact tier tie deterministically by id', () => {
    const x = cand({ id: 'x', px: 0, widthPx: 60, tier: 2 });
    const y = cand({ id: 'y', px: 20, widthPx: 60, tier: 2 });
    expect(placeLabels([x, y]).map(r => r.id)).toEqual(['x']);
    expect(placeLabels([y, x]).map(r => r.id)).toEqual(['x']);
  });

  it('treats exactly-touching labels as non-overlapping', () => {
    const result = placeLabels([cand({ id: 'a', px: 0, widthPx: 50 }), cand({ id: 'b', px: 50, widthPx: 50 })]);
    expect(result.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('a dropped label does not block a THIRD, non-overlapping-with-the-survivor label', () => {
    // b overlaps both a (better tier, kept) and c; b is dropped, but c must still survive
    // since c itself does not overlap the survivor a.
    const result = placeLabels([
      cand({ id: 'a', px: 0, widthPx: 30, tier: 1 }),
      cand({ id: 'b', px: 20, widthPx: 30, tier: 2 }),
      cand({ id: 'c', px: 100, widthPx: 30, tier: 3 })
    ]);
    expect(result.map(r => r.id).sort()).toEqual(['a', 'c']);
  });

  it('returns survivors ordered left to right by position', () => {
    const result = placeLabels([cand({ id: 'b', px: 100 }), cand({ id: 'a', px: 0 })]);
    expect(result.map(r => r.id)).toEqual(['a', 'b']);
  });
});
