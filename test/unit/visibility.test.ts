/**
 * The per-camera decisions every renderer shares (app/lib/map/visibility.ts): capital rings and
 * their names, micro modes. Pure predicates over the real committed payload — no browser, no
 * canvas — so the thresholds' relations hold whichever renderer draws them.
 *
 *   npm run test:unit
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import type { WorldData } from '~/lib/map/types';

beforeAll(() => {
  class StubPath2D { moveTo() {} lineTo() {} closePath() {} }
  (globalThis as { Path2D?: unknown }).Path2D ??= StubPath2D;
});

async function loadRealWorld() {
  const { buildWorld } = await import('~/lib/map/topology');
  const path = join(process.cwd(), 'public', 'data', 'geography', 'world.json');
  return buildWorld(JSON.parse(readFileSync(path, 'utf8')) as WorldData);
}

const viewport = { width: 1000, height: 800 };

/** Does this capital's ring (and so its name) show, centred on it at `factor` x homeZoom? */
async function ringShows(world: Awaited<ReturnType<typeof loadRealWorld>>, iso3: string, factor: number, style = { showCapitals: true } as { showCapitals: boolean; quizMode?: boolean }) {
  const { homeZoom } = await import('~/lib/map/camera');
  const { capitalShapeShowing, capitalsVisible } = await import('~/lib/map/visibility');
  const mark = world.places.find(m => m.place.iso3 === iso3)!;
  const camera = { x: mark.ux, y: mark.uy, zoom: homeZoom(viewport) * factor };
  return capitalsVisible(style, camera, viewport) && capitalShapeShowing(mark, camera, viewport);
}

describe('capitals layer', () => {
  it('ships one capital place per country, with real coordinates', async () => {
    const world = await loadRealWorld();
    expect(world.places).toHaveLength(world.features.length);
    for (const mark of world.places) {
      expect(mark.place.kind).toBe('capital');
      expect(mark.place.name).toBe(mark.feature.country.capital);
      expect(Math.abs(mark.place.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(mark.place.lon)).toBeLessThanOrEqual(180);
    }
    const by = (iso3: string) => world.places.find(m => m.place.iso3 === iso3)!.place;
    expect(by('BRA').lat).toBeCloseTo(-15.8, 0);
    expect(by('AUS').lon).toBeCloseTo(149.1, 0);
    expect(by('BDI').name).toBe('Gitega');
  });

  it('shows no ring below the capital threshold (9x) and a ring above it', async () => {
    const world = await loadRealWorld();
    expect(await ringShows(world, 'AUT', 8)).toBe(false);
    expect(await ringShows(world, 'AUT', 10)).toBe(true);
  });

  it('shows nothing with the layer toggled off or under quizMode', async () => {
    const world = await loadRealWorld();
    expect(await ringShows(world, 'AUT', 12, { showCapitals: false })).toBe(false);
    expect(await ringShows(world, 'AUT', 12, { showCapitals: true, quizMode: true })).toBe(false);
  });

  it('small countries wait longer, by area — Liechtenstein, the Maldives and the Caribbean much later', async () => {
    const world = await loadRealWorld();
    const firstFactor = async (iso3: string) => {
      for (let factor = 1; factor <= 320; factor *= 1.06) if (await ringShows(world, iso3, factor)) return factor;
      return Infinity;
    };
    const first: Record<string, number> = {};
    for (const iso3 of ['BGR', 'CYP', 'JAM', 'LUX', 'MLT', 'LIE', 'MDV', 'BRB', 'KNA']) first[iso3] = await firstFactor(iso3);
    for (const factor of Object.values(first)) expect(factor).toBeGreaterThanOrEqual(9);
    expect(first.BGR).toBeLessThan(first.CYP);
    for (const small of ['LUX', 'MLT', 'LIE', 'MDV', 'BRB', 'KNA']) expect(first[small], small).toBeGreaterThan(first.CYP);
    for (const tiny of ['LIE', 'MDV', 'BRB', 'KNA']) expect(first[tiny], tiny).toBeGreaterThan(first.BGR * 4);
    expect(first.LIE).toBeGreaterThan(first.LUX);
    // hand-set to 200x: Liechtenstein, Saint Vincent, Antigua (within one sweep step of it)
    for (const iso3 of ['LIE', 'VCT', 'ATG']) {
      const f = await firstFactor(iso3);
      expect(f, iso3).toBeGreaterThanOrEqual(200);
      expect(f, iso3).toBeLessThan(200 * 1.06);
    }
  });

  it('a micro-state gets its ring only once its own shape shows, not at the global threshold', async () => {
    const world = await loadRealWorld();
    expect(await ringShows(world, 'MCO', 12)).toBe(false); // past 9x, but Monaco is still a pin
    expect(await ringShows(world, 'MCO', 320)).toBe(true);
  });

  it('a capital ring never shows before its country is wide enough to carry it — swept over every zoom', async () => {
    const { homeZoom } = await import('~/lib/map/camera');
    const { lonToX } = await import('~/lib/map/projection');
    const { CAPITAL_MIN_SHAPE_WIDTH } = await import('~/lib/map/thresholds');
    const world = await loadRealWorld();
    for (const iso3 of ['MCO', 'SMR', 'LIE', 'MLT', 'LUX', 'AND', 'SGP', 'BHR', 'MDV', 'KNA']) {
      const mark = world.places.find(m => m.place.iso3 === iso3)!;
      const bbox = mark.feature.bbox;
      for (let factor = 1; factor <= 320; factor *= 1.15) {
        if (!(await ringShows(world, iso3, factor))) continue;
        const width = bbox ? (lonToX(bbox[2]) - lonToX(bbox[0])) * homeZoom(viewport) * factor : 0;
        expect(width, `${iso3} at ${factor.toFixed(1)}x`).toBeGreaterThanOrEqual(CAPITAL_MIN_SHAPE_WIDTH);
      }
    }
  });
});

describe('microMode', () => {
  it('falls back to showPins and lets `micro` win', async () => {
    const { microMode } = await import('~/lib/map/style');
    expect(microMode({ showPins: true })).toBe('full');
    expect(microMode({ showPins: false })).toBe('off');
    expect(microMode({ showPins: false, micro: 'dots' })).toBe('dots');
  });
});
