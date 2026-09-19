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

  it('draws no rings below the dot threshold and rings above it', async () => {
    const below = await draw({ showCapitals: true }, 1.8);
    expect(below.ctx.arc).not.toHaveBeenCalled();
    const above = await draw({ showCapitals: true }, 2.2);
    expect(above.ctx.arc).toHaveBeenCalled();
  });

  it('draws no rings with the layer toggled off', async () => {
    const { ctx } = await draw({ showCapitals: false }, 3);
    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it('labels capitals only above the label threshold', async () => {
    const dotsOnly = await draw({ showCapitals: true }, 3);
    const names = dotsOnly.world.places.map(m => m.place.name);
    expect(drawnText(dotsOnly.ctx, names)).toEqual([]);
    const labelled = await draw({ showCapitals: true }, 8);
    expect(drawnText(labelled.ctx, names).length).toBeGreaterThan(0);
  });

  it('quizMode draws no capital ring and no capital name, at a zoom where both would show', async () => {
    const { ctx, world } = await draw({ showCapitals: true, quizMode: true }, 8);
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
    const camera = await europe(6);
    const vienna = world.places.find(m => m.place.iso3 === 'AUT')!;
    const [sx, sy] = worldToScreen(camera, viewport, vienna.ux, vienna.uy);
    const rc = { ctx: mockCtx(), camera, viewport, dpr: 1 };

    expect(pickPlace(rc, world, { showCapitals: true }, sx, sy)?.place.name).toBe('Vienna');
    expect(pickPlace(rc, world, { showCapitals: true }, sx + 40, sy + 40)).toBeNull();
    expect(pickPlace(rc, world, { showCapitals: true, quizMode: true }, sx, sy)).toBeNull();
    expect(pickPlace(rc, world, { showCapitals: false }, sx, sy)).toBeNull();
    expect(pickPlace({ ...rc, camera: await europe(1.5) }, world, { showCapitals: true }, sx, sy)).toBeNull();
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
