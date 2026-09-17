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

describe('buildWorld — antimeridian countries, against the real payload', () => {
  async function loadRealWorld() {
    const { buildWorld } = await import('~/lib/map/topology');
    const path = join(process.cwd(), 'public', 'data', 'geography', 'world.json');
    const data = JSON.parse(readFileSync(path, 'utf8')) as WorldData;
    return buildWorld(data);
  }

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

  it("Fiji's and Kiribati's bbox spans are each under 30 degrees", async () => {
    const world = await loadRealWorld();
    for (const iso3 of ['FJI', 'KIR']) {
      const feature = world.byIso3.get(iso3)!;
      const [minLon, , maxLon] = feature.bbox!;
      expect(maxLon - minLon, `${iso3} span`).toBeLessThan(30);
    }
  });
});
