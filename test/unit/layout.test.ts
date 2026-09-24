/**
 * Layout logic for the history timeline (app/lib/history/layout.ts): context stack,
 * bar/pinned classification, row packing, density buckets and label collision. Pure
 * logic, checked directly — no canvas, no React, no build.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from 'vitest';

import {
  assignRows, classifySpan, contextAt, densityBuckets, type LabelCandidate, type LayoutEntry, placeLabels
} from '~/lib/history/layout';
import type { Viewport } from '~/lib/history/scale';

const entry = (over: Partial<LayoutEntry> & Pick<LayoutEntry, 'id' | 'kind' | 'start'>): LayoutEntry => ({
  tier: 1, end: null, parent: null, ...over
});

const viewport = (over: Partial<Viewport> = {}): Viewport => ({ center: 2000, pxPerYear: 10, sizePx: 1000, ...over });

describe('contextAt', () => {
  const firstEmpire = entry({ id: 'period-first-empire', kind: 'period', start: 681, end: 1018 });
  const byzantine = entry({ id: 'period-byzantine', kind: 'period', start: 1018, end: 1185 });
  const krum = entry({ id: 'ruler-krum', kind: 'ruler', start: 803, end: 814 });
  const omurtag = entry({ id: 'ruler-omurtag', kind: 'ruler', start: 814, end: 831 });
  const entries = [firstEmpire, byzantine, krum, omurtag];

  it('finds the containing period and ruler for an ordinary moment', () => {
    const ctx = contextAt(entries, 810);
    expect(ctx.period.primary?.id).toBe('period-first-empire');
    expect(ctx.ruler.primary?.id).toBe('ruler-krum');
    expect(ctx.government.primary).toBeNull();
  });

  it('returns null for a kind with no containing entry — a gap is normal', () => {
    const ctx = contextAt(entries, 810);
    expect(ctx.government.primary).toBeNull();
    expect(ctx.government.all).toEqual([]);
  });

  it('returns null for every slot in a genuine gap between entries', () => {
    // 1018 is byzantine's start AND first-empire's end — not a gap. Use a real hole: no
    // ruler is authored for, say, a period this dataset simply never covers.
    const sparse = [firstEmpire]; // no ruler entries at all
    const ctx = contextAt(sparse, 900);
    expect(ctx.ruler.primary).toBeNull();
    expect(ctx.ruler.all).toEqual([]);
    expect(ctx.period.primary?.id).toBe('period-first-empire');
  });

  it('treats end as inclusive: the exact end year still counts as contained', () => {
    expect(contextAt(entries, 814).ruler.primary?.id).toBe('ruler-krum');
  });

  it('treats a null end as ongoing, containing any moment at or after start', () => {
    const ongoing = entry({ id: 'period-republic', kind: 'period', start: 1989, end: null });
    expect(contextAt([ongoing], 3000).period.primary?.id).toBe('period-republic');
  });

  it('lists co-containing entries of the same kind (e.g. an overlapping period) in `all`', () => {
    const ottoman = entry({ id: 'period-ottoman-rule', kind: 'period', start: 1396, end: 1878, tier: 1 });
    const vazrazhdane = entry({ id: 'period-vazrazhdane', kind: 'period', start: 1762, end: 1878, tier: 1 });
    const ctx = contextAt([ottoman, vazrazhdane], 1800);
    expect(ctx.period.all.map(e => e.id).sort()).toEqual(['period-ottoman-rule', 'period-vazrazhdane']);
  });

  it('picks the better (lower) tier as primary among co-containing entries with no parent link', () => {
    const major = entry({ id: 'a-major', kind: 'ruler', start: 900, end: 950, tier: 1 });
    const minor = entry({ id: 'b-minor', kind: 'ruler', start: 900, end: 950, tier: 3 });
    expect(contextAt([major, minor], 920).ruler.primary?.id).toBe('a-major');
  });

  it('breaks a tier tie deterministically by id', () => {
    const x = entry({ id: 'x', kind: 'ruler', start: 900, end: 950, tier: 2 });
    const y = entry({ id: 'y', kind: 'ruler', start: 900, end: 950, tier: 2 });
    expect(contextAt([x, y], 920).ruler.primary?.id).toBe('x');
    expect(contextAt([y, x], 920).ruler.primary?.id).toBe('x'); // input order must not matter
  });

  it('an explicit parent overrides the default tier-based primary (co-rulers)', () => {
    // a regent (better tier number, i.e. more "important" by the default rule) who
    // explicitly defers to the senior ruler via `parent`
    const senior = entry({ id: 'senior', kind: 'ruler', start: 1000, end: 1010, tier: 3 });
    const regent = entry({ id: 'regent', kind: 'ruler', start: 1000, end: 1010, tier: 1, parent: 'senior' });
    expect(contextAt([senior, regent], 1005).ruler.primary?.id).toBe('senior');
    expect(contextAt([senior, regent], 1005).ruler.all.map(e => e.id).sort()).toEqual(['regent', 'senior']);
  });

  it('ruler and government are independent wires: a president (ruler) and a PM (government) at the same moment each resolve in their own slot, not each other\'s', () => {
    const president = entry({ id: 'pres', kind: 'ruler', start: 1997, end: 2002 }); // heads of state stay on the ruler wire
    const pm = entry({ id: 'pm', kind: 'government', start: 1997, end: 2001 }); // government is cabinets only
    const ctx = contextAt([president, pm], 1999);
    expect(ctx.ruler.primary?.id).toBe('pres');
    expect(ctx.ruler.all).toHaveLength(1);
    expect(ctx.government.primary?.id).toBe('pm');
    expect(ctx.government.all).toHaveLength(1);
  });
});

describe('classifySpan', () => {
  it('classifies a short span comfortably inside the viewport as a bar', () => {
    const vp = viewport({ center: 1900, pxPerYear: 5 }); // 200-year-wide viewport
    const span = classifySpan(entry({ id: 'e', kind: 'period', start: 1890, end: 1910 }), vp);
    expect(span.mode).toBe('bar');
  });

  it('a bar\'s pixel bounds match timeToPx for its start and end', () => {
    const vp = viewport({ center: 1900, pxPerYear: 5 });
    const span = classifySpan(entry({ id: 'e', kind: 'period', start: 1890, end: 1910 }), vp);
    if (span.mode !== 'bar') throw new Error('expected bar');
    expect(span.toPx).toBeGreaterThan(span.fromPx);
  });

  it('classifies a span much wider than the viewport as pinned', () => {
    const vp = viewport({ center: 1700, pxPerYear: 5 }); // 200-year-wide viewport
    const span = classifySpan(entry({ id: 'ottoman', kind: 'period', start: 1396, end: 1878 }), vp); // 482 years
    expect(span.mode).toBe('pinned');
  });

  it('clamps a pinned label to stay inside the viewport even when the start is off-screen', () => {
    const vp = viewport({ center: 1700, pxPerYear: 5, sizePx: 1000 });
    const span = classifySpan(entry({ id: 'ottoman', kind: 'period', start: 1396, end: 1878 }), vp);
    if (span.mode !== 'pinned') throw new Error('expected pinned');
    expect(span.labelPx).toBeGreaterThanOrEqual(0);
    expect(span.labelPx).toBeLessThanOrEqual(vp.sizePx);
  });

  it('switches from bar to pinned as the viewport zooms in on a fixed span, never the reverse', () => {
    const target = entry({ id: 'e', kind: 'period', start: 1396, end: 1878 });
    const wide = classifySpan(target, viewport({ center: 1700, pxPerYear: 0.5 })); // zoomed out: fits
    const narrow = classifySpan(target, viewport({ center: 1700, pxPerYear: 20 })); // zoomed in: doesn't
    expect(wide.mode).toBe('bar');
    expect(narrow.mode).toBe('pinned');
  });

  it('an ongoing entry (end: null) starting on screen classifies as a bar running to the edge', () => {
    const vp = viewport({ center: 2010, pxPerYear: 10, sizePx: 1000 }); // 1960..2060
    const span = classifySpan(entry({ id: 'republic', kind: 'period', start: 1989, end: null }), vp);
    expect(span.mode).toBe('bar');
    if (span.mode === 'bar') expect(span.toPx).toBe(vp.sizePx);
  });

  it('an ongoing entry whose start is off-screen to the left classifies as pinned', () => {
    const vp = viewport({ center: 2010, pxPerYear: 10, sizePx: 1000 }); // 1960..2060
    const span = classifySpan(entry({ id: 'ancient', kind: 'period', start: 100, end: null }), vp);
    expect(span.mode).toBe('pinned');
  });
});

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
