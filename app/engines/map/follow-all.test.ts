/**
 * The quiz camera's target for EVERY country: a finite position inside the world, near the
 * country's real coordinates — never the (0, 0) corner that an unset anchor looks like (the
 * north edge of the map: the Vatican City / San Marino "flies to the North Pole" bug).
 * Dot-only micro-states (no usable shape at the zoom limits) must land at neighbourhood zoom.
 *
 *   npm run test:unit
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { clamp, homeZoom, NO_INSETS } from './camera';
import { cameraForTarget, markerPoint, NO_SHAPE_ZOOM_FACTOR, quizFollowTarget } from './follow';
import { latToY, lonToX, wrapX } from './projection';
import type { Feature, World, WorldData } from './types';

const viewport = { width: 1000, height: 800 };
const HOME = homeZoom(viewport);
const options = { noShapeZoom: HOME * NO_SHAPE_ZOOM_FACTOR };
const dock = { ...NO_INSETS, bottom: 120 };

let world: World;
beforeAll(async () => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class { moveTo() {} lineTo() {} closePath() {} };
  const { buildWorld } = await import('./topology');
  const read = (name: string) => JSON.parse(readFileSync(join(process.cwd(), `public/data/geography/${name}.json`), 'utf8'));
  // the client's own payload: coarse geometry + the country facts
  world = buildWorld({ ...read('world-coarse'), countries: read('world').countries } as WorldData);
});

const real = (f: Feature) => ({ x: wrapX(lonToX(f.country.latlng[1])), y: latToY(f.country.latlng[0]) });
const markFor = (f: Feature) => world.places.find(p => p.feature === f) ?? null;
const cameras = [
  { x: 0.5, y: 0.46, zoom: HOME },
  { x: 0.1, y: 0.7, zoom: HOME * 40 }
];

describe('quiz follow target, every country', () => {
  it('is a finite point inside the world, near the real coordinates', () => {
    for (const f of world.features) {
      for (const place of [null, markFor(f)]) {
        const target = quizFollowTarget(f, place, viewport);
        expect(target, f.country.iso3).not.toBeNull();
        const { x, y } = target!.focus;
        expect(Number.isFinite(x) && Number.isFinite(y), f.country.iso3).toBe(true);
        expect(x > -0.5 && x < 1.5 && y > 0 && y < 1, `${f.country.iso3} ${x},${y}`).toBe(true);
        // within ~25 degrees of the record's lat/lng
        if (target!.box) continue; // a shape's own centre can be far from its record's point (Canada)
        const r = real(f);
        const dx = Math.min(Math.abs(x - r.x), 1 - Math.abs(x - r.x));
        expect(dx, f.country.iso3).toBeLessThan(0.07);
        expect(Math.abs(y - r.y), f.country.iso3).toBeLessThan(0.07);
      }
    }
  });

  it('moves the camera to a finite, in-bounds, nearby view — and dot-only states get neighbourhood zoom', () => {
    for (const f of world.features) {
      const target = quizFollowTarget(f, null, viewport)!;
      for (const cam of cameras) {
        const next = cameraForTarget(cam, viewport, dock, target, options);
        if (!next) continue;
        const dest = clamp(next, viewport);
        expect([dest.x, dest.y, dest.zoom].every(Number.isFinite), f.country.iso3).toBe(true);
        expect(dest.y > 0 && dest.y < 1, f.country.iso3).toBe(true);
        if (!target.box) {
          expect(dest.zoom, f.country.iso3).toBeGreaterThanOrEqual(HOME * NO_SHAPE_ZOOM_FACTOR * 0.999);
          if (cam.zoom === HOME) expect(dest.zoom, f.country.iso3).toBeCloseTo(HOME * NO_SHAPE_ZOOM_FACTOR, 6);
          // the target is on screen, not the corner of the map
          const r = real(f);
          expect(Math.abs(dest.y - r.y) * dest.zoom, f.country.iso3).toBeLessThan(viewport.height / 2);
        }
      }
    }
  });

  it('gives a country without a shape (Vatican City, San Marino) its real position, not the (0, 0) corner', () => {
    for (const iso3 of ['VAT', 'SMR']) {
      const f = world.byIso3.get(iso3)!;
      expect(f.bbox, iso3).toBeNull();
      const cap = world.places.find(m => m.feature === f)!;
      expect(f.uy, iso3).toBeCloseTo(cap.uy, 9); // the pin sits on the capital, inside the country
      expect(f.ux, iso3).toBeCloseTo(cap.ux, 9);
      expect(f.uy, iso3).toBeGreaterThan(0.3);
    }
  });

  it('never targets the (0, 0) corner for a feature whose anchor is unset', () => {
    for (const iso3 of ['VAT', 'SMR', 'MCO', 'LIE', 'SGP', 'AND', 'MLT']) {
      const f = world.byIso3.get(iso3)!;
      const bare: Feature = { ...f, bbox: null, polygons: [], path: null, fullPath: null, halo: null, ux: 0, uy: 0 };
      const point = markerPoint(bare, null)!;
      expect(point, iso3).not.toBeNull();
      expect(point.y, iso3).toBeCloseTo(real(f).y, 6);
      const target = quizFollowTarget(bare, null, viewport)!;
      expect(target.box).toBeNull();
      expect(target.focus.y).toBeGreaterThan(0.2);
    }
  });

  it('does nothing when a country has no position at all', () => {
    const f = world.byIso3.get('VAT')!;
    const lost = { ...f, bbox: null, ux: 0, uy: 0, halo: null, country: { ...f.country, latlng: [NaN, NaN] as [number, number] } };
    expect(markerPoint(lost, null)).toBeNull();
    expect(quizFollowTarget(lost, null, viewport)).toBeNull();
  });
});
