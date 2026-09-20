/**
 * Unit tests for the quiz-mode label suppression in app/lib/map/renderer.ts — the
 * regression test for CLAUDE.md's "the map must not leak the answer" requirement.
 *
 * Playwright can't launch in this sandbox (see CLAUDE.md's Known rough edges) and
 * node-canvas here doesn't implement Path2D, so a real pixel render isn't available.
 * Instead this drives the actual render() function against a mocked 2D context and
 * asserts on which drawing calls it makes — fillText/strokeText are the only calls that
 * could ever print a country's name, so "never called under quizMode" is a direct,
 * deterministic proof of the no-labels requirement rather than an eyeballed screenshot.
 *
 *   npm run test:unit
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { WorldData } from '~/lib/map/types';

beforeAll(() => {
  // buildWorld() calls `new Path2D()` per feature; only the geometry/labelling logic is
  // under test here, so a no-op stub is enough (mirrors topology.test.ts's own stub).
  class StubPath2D {
    moveTo() {}
    lineTo() {}
    closePath() {}
  }
  (globalThis as { Path2D?: unknown }).Path2D ??= StubPath2D;
});

function mockCtx() {
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    isPointInPath: vi.fn(() => false)
  };
  // fillStyle/strokeStyle/lineWidth/etc. are plain assignable properties on a real
  // context — a mutable object property stands in fine, nothing reads them back here.
  return ctx as unknown as CanvasRenderingContext2D;
}

async function loadRealWorld() {
  const { buildWorld } = await import('~/lib/map/topology');
  const path = join(process.cwd(), 'public', 'data', 'geography', 'world.json');
  const data = JSON.parse(readFileSync(path, 'utf8')) as WorldData;
  return buildWorld(data);
}

describe('render() — quiz mode never draws a country name', () => {
  it('draws no text at a zoom that would normally label countries, when quizMode is true', async () => {
    const { render } = await import('~/lib/map/renderer');
    const { homeZoom } = await import('~/lib/map/camera');
    const world = await loadRealWorld();

    const viewport = { width: 1000, height: 800 };
    const camera = { x: 0.5, y: 0.46, zoom: homeZoom(viewport) * 5 }; // well past the label-drawing threshold
    const ctx = mockCtx();

    render(
      { ctx, camera, viewport, dpr: 1 },
      world,
      { fill: () => '#31485A', stroke: () => ['#000', 1] as [string, number], showLabels: true, showPins: true, quizMode: true },
      new Set(),
      'sans-serif'
    );

    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.strokeText).not.toHaveBeenCalled();
  });

  it('the same camera and style DOES draw text when quizMode is false — proves the test above is not vacuous', async () => {
    const { render } = await import('~/lib/map/renderer');
    const { homeZoom } = await import('~/lib/map/camera');
    const world = await loadRealWorld();

    const viewport = { width: 1000, height: 800 };
    const camera = { x: 0.5, y: 0.46, zoom: homeZoom(viewport) * 5 };
    const ctx = mockCtx();

    render(
      { ctx, camera, viewport, dpr: 1 },
      world,
      { fill: () => '#31485A', stroke: () => ['#000', 1] as [string, number], showLabels: true, showPins: true, quizMode: false },
      new Set(),
      'sans-serif'
    );

    expect(ctx.fillText).toHaveBeenCalled();
  });
});

describe('capitals layer', () => {
  const viewport = { width: 1000, height: 800 };
  const plain = { fill: () => '#31485A', stroke: () => ['#000', 1] as [string, number], showLabels: true, showPins: false };

  /** A camera centred on Vienna at `factor` x homeZoom — Central Europe, where capitals are dense. */
  async function europe(factor: number) {
    const { homeZoom } = await import('~/lib/map/camera');
    const { lonToX, latToY } = await import('~/lib/map/projection');
    return { x: lonToX(16.37), y: latToY(48.2), zoom: homeZoom(viewport) * factor };
  }

  async function draw(style: Record<string, unknown>, factor: number) {
    const { render } = await import('~/lib/map/renderer');
    const world = await loadRealWorld();
    const ctx = mockCtx();
    render({ ctx, camera: await europe(factor), viewport, dpr: 1 }, world, { ...plain, ...style }, new Set(), 'sans-serif');
    return { ctx, world };
  }

  const drawnText = (ctx: CanvasRenderingContext2D, names: string[]) =>
    (ctx.fillText as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(c => c[0] as string)
      .filter(t => names.includes(t));

  it('ships one capital place per country, with real coordinates', async () => {
    const { world } = await draw({ showCapitals: true }, 1);
    expect(world.places).toHaveLength(world.features.length);
    for (const mark of world.places) {
      expect(mark.place.kind).toBe('capital');
      expect(mark.place.name).toBe(mark.feature.country.capital);
      expect(Math.abs(mark.place.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(mark.place.lon)).toBeLessThanOrEqual(180);
    }
    // PPLC, not "biggest city": Brasília and Canberra
    const by = (iso3: string) => world.places.find(m => m.place.iso3 === iso3)!.place;
    expect(by('BRA').lat).toBeCloseTo(-15.8, 0);
    expect(by('AUS').lon).toBeCloseTo(149.1, 0);
    expect(by('BDI').name).toBe('Gitega');
  });

  it('draws no rings below the capital threshold (9x) and rings above it', async () => {
    const below = await draw({ showCapitals: true }, 8);
    expect(below.ctx.arc).not.toHaveBeenCalled();
    const above = await draw({ showCapitals: true }, 10);
    expect(above.ctx.arc).toHaveBeenCalled();
  });

  it('draws no rings with the layer toggled off', async () => {
    const { ctx } = await draw({ showCapitals: false }, 8);
    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it('a ring and its name appear together — never a ring alone', async () => {
    const early = await draw({ showCapitals: true }, 8);
    const names = early.world.places.map(m => m.place.name);
    expect(early.ctx.arc).not.toHaveBeenCalled();
    expect(drawnText(early.ctx, names)).toEqual([]);
    const late = await draw({ showCapitals: true }, 12);
    expect(late.ctx.arc).toHaveBeenCalled();
    expect(drawnText(late.ctx, names).length).toBeGreaterThan(0);
  });

  it('small countries wait longer, by area — Liechtenstein, the Maldives and the Caribbean much later', async () => {
    const { render, pickPlace } = await import('~/lib/map/renderer');
    const { homeZoom, worldToScreen } = await import('~/lib/map/camera');
    const world = await loadRealWorld();
    /** The first zoom factor (x home) at which this capital's ring can be picked, centred on it. */
    const firstFactor = (iso3: string) => {
      const mark = world.places.find(m => m.place.iso3 === iso3)!;
      for (let factor = 1; factor <= 320; factor *= 1.06) {
        const camera = { x: mark.ux, y: mark.uy, zoom: homeZoom(viewport) * factor };
        const [sx, sy] = worldToScreen(camera, viewport, mark.ux, mark.uy);
        if (pickPlace({ ctx: mockCtx(), camera, viewport, dpr: 1 }, world, { showCapitals: true }, sx, sy)) return { factor, mark };
      }
      return { factor: Infinity, mark };
    };
    const first: Record<string, number> = {};
    for (const iso3 of ['BGR', 'CYP', 'JAM', 'LUX', 'MLT', 'LIE', 'MDV', 'BRB', 'KNA']) first[iso3] = firstFactor(iso3).factor;

    for (const factor of Object.values(first)) expect(factor).toBeGreaterThanOrEqual(9);
    expect(first.BGR).toBeLessThan(first.CYP);
    // "one or two zooms" (doublings) after a mid-size country, and much later for the tiny ones
    for (const small of ['LUX', 'MLT', 'LIE', 'MDV', 'BRB', 'KNA']) {
      expect(first[small], small).toBeGreaterThan(first.CYP);
    }
    for (const tiny of ['LIE', 'MDV', 'BRB', 'KNA']) expect(first[tiny], tiny).toBeGreaterThan(first.BGR * 4);
    expect(first.LIE).toBeGreaterThan(first.LUX);
    // hand-set to 200x: Liechtenstein, Saint Vincent, Antigua (within one sweep step of it)
    for (const iso3 of ['LIE', 'VCT', 'ATG']) {
      const f = iso3 in first ? first[iso3] : firstFactor(iso3).factor;
      expect(f, iso3).toBeGreaterThanOrEqual(200);
      expect(f, iso3).toBeLessThan(200 * 1.06);
    }

    // and the NAME arrives at that same zoom, not after it: one step before, neither; at it, both
    for (const iso3 of ['LIE', 'CYP', 'MDV']) {
      const { factor, mark } = firstFactor(iso3);
      const at = (f: number) => {
        const ctx = mockCtx();
        const camera = { x: mark.ux, y: mark.uy, zoom: homeZoom(viewport) * f };
        render({ ctx, camera, viewport, dpr: 1 }, world, { ...plain, showCapitals: true }, new Set(), 'sans-serif');
        return drawnText(ctx, [mark.place.name]).length;
      };
      expect(at(factor / 1.06 / 1.02), `${iso3} name just before`).toBe(0);
      expect(at(factor * 1.001), `${iso3} name with its ring`).toBeGreaterThan(0);
    }
  });

  it('a micro-state gets its ring only once its own shape shows, not at the global threshold', async () => {
    const { render, pickPlace } = await import('~/lib/map/renderer');
    const { homeZoom, worldToScreen } = await import('~/lib/map/camera');
    const world = await loadRealWorld();
    const monaco = world.places.find(m => m.place.iso3 === 'MCO')!;
    const rings = (factor: number) => {
      const ctx = mockCtx();
      const camera = { x: monaco.ux, y: monaco.uy, zoom: homeZoom(viewport) * factor };
      render({ ctx, camera, viewport, dpr: 1 }, world, { ...plain, showCapitals: true }, new Set(), 'sans-serif');
      const [sx, sy] = worldToScreen(camera, viewport, monaco.ux, monaco.uy);
      const hit = pickPlace({ ctx, camera, viewport, dpr: 1 }, world, { showCapitals: true }, sx, sy);
      return { arcs: (ctx.arc as unknown as { mock: { calls: unknown[][] } }).mock.calls.length, hit };
    };
    // 12x is past the global threshold (big neighbours have rings) but Monaco is still a
    // pin: no ring of its own, and not hittable
    expect(rings(12).arcs).toBeGreaterThan(0);
    expect(rings(12).hit).toBeNull();
    // deep enough that Monaco is a real shape: its ring shows and can be picked
    const deep = rings(320);
    expect(deep.arcs).toBeGreaterThan(0);
    expect(deep.hit?.place.name).toBe('Monaco');
  });

  it('a capital ring never shows before its country is wide enough to carry it — swept over every zoom', async () => {
    const { pickPlace } = await import('~/lib/map/renderer');
    const { homeZoom, worldToScreen } = await import('~/lib/map/camera');
    const { lonToX } = await import('~/lib/map/projection');
    const { CAPITAL_MIN_SHAPE_WIDTH } = await import('~/lib/map/thresholds');
    const world = await loadRealWorld();
    for (const iso3 of ['MCO', 'SMR', 'LIE', 'MLT', 'LUX', 'AND', 'SGP', 'BHR', 'MDV', 'KNA']) {
      const mark = world.places.find(m => m.place.iso3 === iso3)!;
      const bbox = mark.feature.bbox;
      let firstRingWidth: number | null = null;
      for (let factor = 1; factor <= 320; factor *= 1.15) {
        const camera = { x: mark.ux, y: mark.uy, zoom: homeZoom(viewport) * factor };
        const [sx, sy] = worldToScreen(camera, viewport, mark.ux, mark.uy);
        const shows = pickPlace({ ctx: mockCtx(), camera, viewport, dpr: 1 }, world, { showCapitals: true }, sx, sy) !== null;
        const width = bbox ? (lonToX(bbox[2]) - lonToX(bbox[0])) * camera.zoom : 0;
        if (shows) {
          firstRingWidth ??= width;
          expect(width, `${iso3} at ${factor.toFixed(1)}x`).toBeGreaterThanOrEqual(CAPITAL_MIN_SHAPE_WIDTH);
        }
      }
      // (a country with no geometry, or one that never reaches the width at 320x, simply never shows a ring)
      if (firstRingWidth !== null) expect(firstRingWidth).toBeGreaterThanOrEqual(CAPITAL_MIN_SHAPE_WIDTH);
    }
  });

  it('the quiz target ring is not drawn beside a country that is still a pin', async () => {
    const { render } = await import('~/lib/map/renderer');
    const { homeZoom } = await import('~/lib/map/camera');
    const world = await loadRealWorld();
    const monaco = world.places.find(m => m.place.iso3 === 'MCO')!;
    const ctx = mockCtx();
    render(
      { ctx, camera: { x: monaco.ux, y: monaco.uy, zoom: homeZoom(viewport) * 6 }, viewport, dpr: 1 },
      world,
      { ...plain, showCapitals: true, quizMode: true, quizPlace: monaco, showPins: false },
      new Set(),
      'sans-serif'
    );
    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it('quizMode draws no capital ring and no capital name, at a zoom where both would show', async () => {
    const { ctx, world } = await draw({ showCapitals: true, quizMode: true }, 12);
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.strokeText).not.toHaveBeenCalled();
    const names = world.places.map(m => m.place.name);
    expect(drawnText(ctx, names)).toEqual([]);
  });

  it('pickPlace finds a ring, and returns nothing under quizMode or with the layer off', async () => {
    const { pickPlace } = await import('~/lib/map/renderer');
    const { worldToScreen } = await import('~/lib/map/camera');
    const world = await loadRealWorld();
    const camera = await europe(12);
    const vienna = world.places.find(m => m.place.iso3 === 'AUT')!;
    const [sx, sy] = worldToScreen(camera, viewport, vienna.ux, vienna.uy);
    const rc = { ctx: mockCtx(), camera, viewport, dpr: 1 };

    expect(pickPlace(rc, world, { showCapitals: true }, sx, sy)?.place.name).toBe('Vienna');
    expect(pickPlace(rc, world, { showCapitals: true }, sx + 40, sy + 40)).toBeNull();
    expect(pickPlace(rc, world, { showCapitals: true, quizMode: true }, sx, sy)).toBeNull();
    expect(pickPlace(rc, world, { showCapitals: false }, sx, sy)).toBeNull();
    expect(pickPlace({ ...rc, camera: await europe(8) }, world, { showCapitals: true }, sx, sy)).toBeNull();
  });

  it('quizMode draws ONLY the quiz target\'s ring, at world zoom, and still no text', async () => {
    const { render } = await import('~/lib/map/renderer');
    const world = await loadRealWorld();
    const bulgaria = world.places.find(m => m.place.iso3 === 'BGR')!;
    const ctx = mockCtx();
    render(
      { ctx, camera: await europe(1), viewport, dpr: 1 },
      world,
      { ...plain, showCapitals: true, quizMode: true, quizPlace: bulgaria },
      new Set(),
      'sans-serif'
    );
    // two concentric rings (ring + halo), each stroked twice — and nothing else
    expect(ctx.arc).toHaveBeenCalledTimes(2);
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.strokeText).not.toHaveBeenCalled();
  });

  it('a quizPlace outside quizMode is ignored — the ring is a quiz surface only', async () => {
    const { ctx, world } = await draw({ showCapitals: false, quizPlace: null }, 1);
    expect(ctx.arc).not.toHaveBeenCalled();
    const { render } = await import('~/lib/map/renderer');
    const ctx2 = mockCtx();
    render(
      { ctx: ctx2, camera: await europe(1), viewport, dpr: 1 },
      world,
      { ...plain, showCapitals: false, quizPlace: world.places[0] },
      new Set(),
      'sans-serif'
    );
    expect(ctx2.arc).not.toHaveBeenCalled();
  });
});

describe('the new-target pulse', () => {
  const viewport = { width: 1000, height: 800 };
  const plain = { fill: () => '#31485A', stroke: () => ['#000', 1] as [string, number], showLabels: true, showPins: false };

  async function drawWith(pulse: { ux: number; uy: number; t: number } | undefined, quizMode = true) {
    const { render } = await import('~/lib/map/renderer');
    const { homeZoom } = await import('~/lib/map/camera');
    const world = await loadRealWorld();
    const ctx = mockCtx();
    const camera = { x: 0.5, y: 0.46, zoom: homeZoom(viewport) };
    render({ ctx, camera, viewport, dpr: 1 }, world, { ...plain, quizMode }, new Set(), 'sans-serif', pulse);
    return ctx;
  }

  it('draws exactly one ring while pulsing, in brass, and nothing when there is no pulse', async () => {
    expect((await drawWith(undefined)).arc).not.toHaveBeenCalled();
    const ctx = await drawWith({ ux: 0.5, uy: 0.4, t: 0.5 });
    expect(ctx.arc).toHaveBeenCalledTimes(1);
    expect((ctx as unknown as { strokeStyle: string }).strokeStyle).toMatch(/^rgba\(232,163,61,/);
  });

  it('grows and fades: later in the pulse the ring is bigger and more transparent', async () => {
    const radius = async (t: number) =>
      ((await drawWith({ ux: 0.5, uy: 0.4, t })).arc as unknown as { mock: { calls: number[][] } }).mock.calls[0][2];
    expect(await radius(0.8)).toBeGreaterThan(await radius(0.2));
    const ctx = await drawWith({ ux: 0.5, uy: 0.4, t: 0.99 });
    const alpha = Number(/,([\d.]+)\)$/.exec((ctx as unknown as { strokeStyle: string }).strokeStyle)![1]);
    expect(alpha).toBeLessThan(0.05);
  });

  it('prints no text — a pulse is not a label', async () => {
    const ctx = await drawWith({ ux: 0.5, uy: 0.4, t: 0.3 });
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.strokeText).not.toHaveBeenCalled();
  });
});
