/**
 * Territory halos: which countries get one, that the antimeridian is handled, and that the
 * renderer's strength curve and hit-test order behave. Runs against the committed payload.
 *
 *   npm run test:unit
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import type { WorldData } from '~/lib/map/types';
// @ts-expect-error plain .mjs build helper, no declarations
import { buildHalo, HALO_MAX_LON_SPAN, HALO_MAX_POINTS, haloLonSpan, qualifiesForHalo } from '../../scripts/lib/halo.mjs';

beforeAll(() => {
  class StubPath2D {
    moveTo() {}
    lineTo() {}
    closePath() {}
  }
  (globalThis as { Path2D?: unknown }).Path2D ??= StubPath2D;
});

const data = JSON.parse(
  readFileSync(join(process.cwd(), 'public', 'data', 'geography', 'world.json'), 'utf8')
) as WorldData;

describe('halo payload', () => {
  const qualifying = data.countries.filter(qualifiesForHalo);

  it('every qualifying country has one, and nobody else does', () => {
    expect(qualifying.length).toBe(17);
    expect(data.halos.map(h => h.id).sort()).toEqual(qualifying.map(c => c.id).sort());
  });

  it('keeps land micro-states, the Caribbean, Malta, Cyprus and Bahrain on pins', () => {
    const ids = new Set(data.halos.map(h => h.id));
    for (const iso3 of ['MCO', 'VAT', 'SMR', 'LIE', 'BHS', 'JAM', 'CYP', 'MLT', 'ATG', 'TTO', 'BHR']) {
      expect(ids.has(data.countries.find(c => c.iso3 === iso3)!.id)).toBe(false);
    }
  });

  it('every halo is at most 48 points and under 60 degrees of longitude, antimeridian countries included', () => {
    for (const { ring } of data.halos) {
      expect(ring.length).toBeGreaterThanOrEqual(3);
      expect(ring.length).toBeLessThanOrEqual(HALO_MAX_POINTS);
      expect(haloLonSpan(ring)).toBeLessThanOrEqual(HALO_MAX_LON_SPAN);
    }
    for (const iso3 of ['KIR', 'FJI']) {
      const id = data.countries.find(c => c.iso3 === iso3)!.id;
      expect(haloLonSpan(data.halos.find(h => h.id === id)!.ring)).toBeLessThan(HALO_MAX_LON_SPAN);
    }
  });

  it('a halo contains its own country\'s land', async () => {
    const { buildWorld } = await import('~/lib/map/topology');
    const world = buildWorld(data);
    for (const feature of world.features) {
      if (!feature.halo) continue;
      const ring = data.halos.find(h => h.id === feature.country.id)!.ring;
      const [minLon, minLat, maxLon, maxLat] = feature.bbox!;
      const lons = ring.map(p => p[0]), lats = ring.map(p => p[1]);
      expect(Math.min(...lons), feature.country.iso3).toBeLessThanOrEqual(minLon);
      expect(Math.max(...lons), feature.country.iso3).toBeGreaterThanOrEqual(maxLon);
      expect(Math.min(...lats), feature.country.iso3).toBeLessThanOrEqual(minLat);
      expect(Math.max(...lats), feature.country.iso3).toBeGreaterThanOrEqual(maxLat);
    }
    expect(world.haloFeatures.length).toBe(17);
    const areas = world.haloFeatures.map(f => f.halo!.area);
    expect(areas).toEqual([...areas].sort((a, b) => a - b));
  });
});

describe('buildHalo', () => {
  it('buffers a lone point by the 120 km floor, all round', () => {
    const ring = buildHalo([[0, 0], [0.01, 0], [0, 0.01]]) as [number, number][];
    const lats = ring.map(p => p[1]);
    expect((Math.max(...lats) - Math.min(...lats)) * 110.574).toBeGreaterThan(230);
    expect(ring.length).toBeLessThanOrEqual(HALO_MAX_POINTS);
  });
  it('returns null for no vertices', () => {
    expect(buildHalo([])).toBeNull();
  });
});

describe('haloStrength / pick', () => {
  it('fades from 1 to 0 as the land becomes readable', async () => {
    const { haloStrength, HALO_FADE_START_PX, HALO_FADE_END_PX } = await import('~/lib/map/thresholds');
    expect(haloStrength(0)).toBe(1);
    expect(haloStrength(HALO_FADE_START_PX)).toBe(1);
    expect(haloStrength(HALO_FADE_END_PX)).toBe(0);
    const mid = haloStrength((HALO_FADE_START_PX + HALO_FADE_END_PX) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('island nations never draw as pins; land micro-states still do', async () => {
    const { buildWorld } = await import('~/lib/map/topology');
    const { drawsAsPin } = await import('~/lib/map/visibility');
    const world = buildWorld(data);
    const camera = { x: 0.5, y: 0.5, zoom: 1000 };
    expect(drawsAsPin(world.byIso3.get('NRU')!, camera)).toBe(false);
    expect(drawsAsPin(world.byIso3.get('MCO')!, camera)).toBe(true);
  });

  it('a halo shows only while the land is too small to read', async () => {
    const { buildWorld } = await import('~/lib/map/topology');
    const { haloAlpha } = await import('~/lib/map/visibility');
    const world = buildWorld(data);
    const nauru = world.byIso3.get('NRU')!;
    const at = (zoom: number) => haloAlpha(nauru, { x: nauru.ux, y: nauru.uy, zoom });
    expect(at(1000)).toBeGreaterThan(0); // world-ish zoom: the land is a speck
    expect(at(1e6)).toBe(0); // zoomed right in: land readable, halo gone
  });
});
