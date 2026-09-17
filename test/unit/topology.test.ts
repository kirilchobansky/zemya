/**
 * Unit tests for the antimeridian fix in app/lib/map/topology.ts, checked against the
 * real, committed payload (public/data/geography/world.json) rather than a fixture — the
 * whole point of the bug was that it only showed up on real, disjoint-across-the-dateline
 * geometry (Russia's mainland, the Aleutians, Kiribati's three archipelagos), not
 * something a small hand-built ring would necessarily reproduce.
 *
 * buildWorld() calls `new Path2D()` for every non-micro feature; Path2D is a canvas API
 * that plain Node doesn't have (vitest.config.ts runs these in the `node` environment, not
 * a browser or jsdom), so a minimal stub is installed before buildWorld() ever runs. Only
 * the geometry math is under test here — nothing reads the stubbed path's contents.
 *
 *   npm run test:unit
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import type { WorldData } from '~/lib/map/types';

beforeAll(() => {
  class StubPath2D {
    moveTo() {}
    lineTo() {}
    closePath() {}
  }
  (globalThis as { Path2D?: unknown }).Path2D ??= StubPath2D;
});

describe('unwrapRing', () => {
  it('a ring crossing +180 comes out strictly increasing, with no jump over 180°', async () => {
    const { unwrapRing } = await import('~/lib/map/topology');
    // a synthetic ring walking steadily east through the antimeridian
    const ring: [number, number][] = [
      [170, 10], [175, 10], [179, 10], [-179, 10], [-175, 10], [-170, 10]
    ];
    const out = unwrapRing(ring);
    expect(out.map(p => p[0])).toEqual([170, 175, 179, 181, 185, 190]);
    for (let i = 1; i < out.length; i++) {
      expect(out[i][0]).toBeGreaterThan(out[i - 1][0]);
      expect(out[i][0] - out[i - 1][0]).toBeLessThan(180);
    }
  });
});

async function loadRealWorld() {
  const { buildWorld } = await import('~/lib/map/topology');
  const path = join(process.cwd(), 'public', 'data', 'geography', 'world.json');
  const data = JSON.parse(readFileSync(path, 'utf8')) as WorldData;
  return buildWorld(data);
}

describe('buildWorld — antimeridian countries, against the real payload', () => {
  it('no country has a bbox longitude span greater than 180 degrees', async () => {
    const world = await loadRealWorld();
    const offenders = world.features
      .filter(f => f.bbox)
      .map(f => ({ iso3: f.country.iso3, span: f.bbox![2] - f.bbox![0] }))
      .filter(f => f.span > 180);
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
  });

  it("Russia's bbox centre longitude sits in Siberia (80-130), not near 0", async () => {
    const world = await loadRealWorld();
    const russia = world.byIso3.get('RUS')!;
    const [minLon, , maxLon] = russia.bbox!;
    const centre = (minLon + maxLon) / 2;
    expect(centre).toBeGreaterThan(80);
    expect(centre).toBeLessThan(130);
  });

  it("Fiji's span stays small", async () => {
    const world = await loadRealWorld();
    const [minLon, , maxLon] = world.byIso3.get('FJI')!.bbox!;
    expect(maxLon - minLon).toBeLessThan(15);
  });

  /**
   * Kiribati is not a small-span case — it is famously the widest-spread country on
   * Earth, its Gilbert, Phoenix and Line Islands genuinely ~39° of true longitude apart
   * (the reason it redrew its own date-line boundary in 1995, so all three groups would
   * share a calendar day). At 1:50m most of that geometry simplified down to degenerate
   * 2-point fragments and got dropped by the `length > 2` filter, leaving only whichever
   * single island happened to survive — which is why an earlier draft of this test
   * expected Kiribati under 30°: that number came from data too coarse to show the real
   * country. At full 1:10m detail the real spread renders, so the assertion here is a
   * generous ceiling above the true ~38.7°, not a tight bound — what actually matters is
   * that it stays nowhere near the 180° that would mean the antimeridian bug is back.
   */
  it("Kiribati's real, wide spread renders without wrapping into a false 180°+ span", async () => {
    const world = await loadRealWorld();
    const [minLon, , maxLon] = world.byIso3.get('KIR')!.bbox!;
    const span = maxLon - minLon;
    expect(span).toBeGreaterThan(30); // it really is this wide once detail is real
    expect(span).toBeLessThan(45);
  });
});

describe('mainBbox — the main-body box quiz framing uses', () => {
  /**
   * Chile's Easter Island sits ~3,700 km off the mainland; feature.bbox spans both (over
   * 40° of longitude), which would centre a quiz camera on open ocean rather than the
   * country. mainBbox drops the exclave — see EXCLAVE_KM in topology.ts.
   */
  it('Chile: mainBbox is much narrower than bbox (Easter Island dropped)', async () => {
    const world = await loadRealWorld();
    const chile = world.byIso3.get('CHL')!;
    const [bMinLon, , bMaxLon] = chile.bbox!;
    const [mMinLon, , mMaxLon] = chile.mainBbox!;
    expect(bMaxLon - bMinLon).toBeGreaterThan(35); // full bbox reaches out to Easter Island
    expect(mMaxLon - mMinLon).toBeLessThan(15); // mainBbox is just the mainland ribbon
    // Juan Fernández and the Desventuradas (~650-850 km offshore) legitimately chain into
    // the mainland cluster and push the west edge out a little — Easter Island (~-109°),
    // nearly 30° further west again, is the one that must be gone
    expect(mMinLon).toBeGreaterThan(-90);
  });

  it('Indonesia: mainBbox keeps the whole archipelago, not just its largest island', async () => {
    const world = await loadRealWorld();
    const indonesia = world.byIso3.get('IDN')!;
    const [bMinLon, , bMaxLon] = indonesia.bbox!;
    const [mMinLon, , mMaxLon] = indonesia.mainBbox!;
    // every major island is close enough to its neighbour to chain into one cluster, so
    // the main-body box should be nearly as wide as the true full extent
    expect(mMaxLon - mMinLon).toBeGreaterThan((bMaxLon - bMinLon) * 0.9);
  });

  it('a single-polygon country has an identical bbox and mainBbox', async () => {
    const world = await loadRealWorld();
    const bulgaria = world.byIso3.get('BGR')!;
    expect(bulgaria.mainBbox).toEqual(bulgaria.bbox);
  });
});

describe('absorbed territories leave no hole-fill seam behind', () => {
  /**
   * Baikonur is cut out of Kazakhstan's own Natural Earth polygon as a hole, and
   * Baikonur's own polygon exactly re-fills that hole — confirmed against the raw
   * source: both reference arc 903, one forward (the hole), one reversed (Baikonur's
   * outer ring). Absorbing Baikonur by simply appending its polygon left both rings in
   * the feature's polygon list: invisible in the fill (same colour) but both still
   * traced by the stroke pass, drawing a visible circle in the middle of Kazakhstan
   * where there should be seamless one-colour territory. build-content.mjs now cancels
   * a hole-fill pair instead of stacking them — this is the regression guard for that.
   */
  it('Kazakhstan has no internal holes after Baikonur is absorbed into it', async () => {
    const world = await loadRealWorld();
    const kazakhstan = world.byIso3.get('KAZ')!;
    const holes = kazakhstan.polygons.filter(polygon => polygon.length > 1);
    expect(holes, `polygons with a leftover hole: ${JSON.stringify(holes)}`).toEqual([]);
  });
});
