/**
 * Layout logic for the history timeline (app/features/history/timeline/layout.ts), first half: context stack,
 * bar/pinned classification (row packing, density buckets and label collision: layout-rows.test.ts). Pure
 * logic, checked directly — no canvas, no React, no build.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from 'vitest';

import {
  classifySpan, contextAt, type LayoutEntry
} from './layout';
import { timeToPx, type Viewport } from './scale';

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

  it('pins a label at the viewport centre when neither edge of the span is on screen', () => {
    const vp = viewport({ center: 1700, pxPerYear: 5, sizePx: 1000 });
    const span = classifySpan(entry({ id: 'ottoman', kind: 'period', start: 1396, end: 1878 }), vp);
    if (span.mode !== 'pinned') throw new Error('expected pinned');
    expect(span.labelPx).toBe(vp.sizePx / 2);
  });

  it('a span with only its END on screen is a bar clipped to 0, not stretched from the left edge', () => {
    // Regression: Ottoman rule (1396-1878) here only has its END (1878) on screen — the
    // raw pixel width of the whole span is much wider than the viewport, but that alone
    // must not make it "pinned" (which would draw a capsule spanning the full width,
    // hiding where 1878 actually falls).
    const vp = viewport({ center: 1900, pxPerYear: 5, sizePx: 1000 }); // visible ~1700..2100
    const span = classifySpan(entry({ id: 'ottoman', kind: 'period', start: 1396, end: 1878 }), vp);
    expect(span.mode).toBe('bar');
    if (span.mode !== 'bar') throw new Error('expected bar');
    expect(span.fromPx).toBe(0); // 1396 is off-screen to the left, clipped to the edge
    expect(span.toPx).toBeCloseTo(timeToPx(1878, vp), 5); // 1878 is genuinely on screen
    expect(span.toPx).toBeLessThan(vp.sizePx);
  });

  it('a span with only its START on screen is a bar starting at the real position (e.g. Ferdinand from 1887), not stretched from the left edge', () => {
    const vp = viewport({ center: 1900, pxPerYear: 5, sizePx: 1000 }); // visible ~1700..2100
    const span = classifySpan(entry({ id: 'ferdinand', kind: 'ruler', start: 1887, end: 2200 }), vp);
    expect(span.mode).toBe('bar');
    if (span.mode !== 'bar') throw new Error('expected bar');
    expect(span.fromPx).toBeCloseTo(timeToPx(1887, vp), 5); // 1887 is genuinely on screen
    expect(span.fromPx).toBeGreaterThan(0);
    expect(span.toPx).toBe(vp.sizePx); // 2200 is off-screen to the right, clipped to the edge
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
