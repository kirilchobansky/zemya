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
