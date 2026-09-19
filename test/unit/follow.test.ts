/**
 * The quiz camera's decisions (app/lib/map/follow.ts): leave alone / pan at the current
 * zoom / zoom out the minimum. Pure maths, so it is checked directly — the behaviour in a
 * real browser is test/smoke.mjs's job.
 *
 *   npm run test:unit
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { homeZoom } from '~/lib/map/camera';
import {
  cameraForTarget, mainlandBox, NO_INSETS, pointTarget, QUIZ_FRAME_PADDING,
  QUIZ_MIN_TARGET_WIDTH_PX, type FollowTarget
} from '~/lib/map/follow';
import { latToY, lonToX } from '~/lib/map/projection';
import type { WorldData } from '~/lib/map/types';

const viewport = { width: 1000, height: 800 };
const HOME = homeZoom(viewport);
const dock = { ...NO_INSETS, bottom: 120 };

/** A country-like box `wPx` x `hPx` on screen at `zoom`, centred on (cx, cy) unit coords. */
const box = (cx: number, cy: number, wPx: number, hPx: number, zoom: number): FollowTarget => ({
  x0: cx - wPx / 2 / zoom, x1: cx + wPx / 2 / zoom,
  y0: cy - hPx / 2 / zoom, y1: cy + hPx / 2 / zoom,
  point: false, marginPx: 12
});

describe('cameraForTarget', () => {
  const camera = { x: 0.5, y: 0.4, zoom: HOME * 8 };

  it('leaves the camera completely alone when the target is fully in view and big enough', () => {
    expect(cameraForTarget(camera, viewport, dock, box(0.5, 0.4, 120, 90, camera.zoom), { sizeWaived: false })).toBeNull();
  });

  it('pans at the SAME zoom when the target is off screen and fits', () => {
    const target = box(0.5 + 1500 / camera.zoom, 0.4, 120, 90, camera.zoom); // 1500 px to the right
    const next = cameraForTarget(camera, viewport, dock, target, { sizeWaived: false })!;
    expect(next.zoom).toBe(camera.zoom);
    expect(next.x).toBeGreaterThan(camera.x);
  });

  it('centres the target in the VISIBLE area, not the canvas — above the dock', () => {
    const target = box(0.5 + 1500 / camera.zoom, 0.4, 120, 90, camera.zoom);
    const next = cameraForTarget(camera, viewport, dock, target, { sizeWaived: false })!;
    // with the target's centre now at the camera's pixel offset, it sits above canvas centre
    const sy = viewport.height / 2 + (0.4 - next.y) * next.zoom;
    expect(sy).toBeCloseTo((0 + (viewport.height - dock.bottom)) / 2, 5);
  });

  it('treats a target hidden under the dock as NOT visible', () => {
    const y = 0.4 + (viewport.height / 2 - 60) / camera.zoom; // 60 px above the canvas bottom: inside the 120 px dock band
    expect(cameraForTarget(camera, viewport, NO_INSETS, box(0.5, y, 100, 30, camera.zoom), { sizeWaived: false })).toBeNull();
    expect(cameraForTarget(camera, viewport, dock, box(0.5, y, 100, 30, camera.zoom), { sizeWaived: false })).not.toBeNull();
  });

  it('treats a target clipped at an edge, or beyond the canvas (where the panel starts), as not visible', () => {
    const clipped = box(0.5 + (viewport.width / 2 - 30) / camera.zoom, 0.4, 100, 60, camera.zoom); // half off the right edge
    expect(cameraForTarget(camera, viewport, dock, clipped, { sizeWaived: false })).not.toBeNull();
    const behindPanel = box(0.5 + (viewport.width / 2 + 200) / camera.zoom, 0.4, 100, 60, camera.zoom);
    expect(cameraForTarget(camera, viewport, dock, behindPanel, { sizeWaived: false })).not.toBeNull();
  });

  it('zooms out the MINIMUM to fit a target too big for the view, and never in', () => {
    const big = box(0.5, 0.4, 3000, 1500, camera.zoom);
    const next = cameraForTarget(camera, viewport, dock, big, { sizeWaived: false })!;
    expect(next.zoom).toBeLessThan(camera.zoom);
    expect(next.zoom).toBeGreaterThan(HOME); // not a jump to the world view
    // it now takes exactly the framing padding of the tighter visible dimension
    const wUnit = big.x1 - big.x0, hUnit = big.y1 - big.y0;
    const fit = Math.min((viewport.width * QUIZ_FRAME_PADDING) / wUnit, ((viewport.height - dock.bottom) * QUIZ_FRAME_PADDING) / hUnit);
    expect(next.zoom).toBeCloseTo(fit, 6);
  });

  it('never zooms IN, even for a tiny target that is off screen', () => {
    const tiny = box(0.9, 0.5, 4, 4, camera.zoom);
    expect(cameraForTarget(camera, viewport, dock, tiny, { sizeWaived: false })!.zoom).toBe(camera.zoom);
  });

  it('a target too narrow to identify counts as not visible — unless the size test is waived', () => {
    const narrow = box(0.5, 0.4, QUIZ_MIN_TARGET_WIDTH_PX - 6, 40, camera.zoom);
    expect(cameraForTarget(camera, viewport, dock, narrow, { sizeWaived: false })).not.toBeNull();
    expect(cameraForTarget(camera, viewport, dock, narrow, { sizeWaived: true })).toBeNull();
  });

  it('a capital dot needs a comfortable margin: inside is fine, hugging an edge is not', () => {
    const margin = 60;
    const inside = pointTarget(0.5, 0.4, margin);
    expect(cameraForTarget(camera, viewport, dock, inside, { sizeWaived: true })).toBeNull();
    const nearEdge = pointTarget(0.5 + (viewport.width / 2 - 20) / camera.zoom, 0.4, margin); // 20 px from the right edge
    expect(cameraForTarget(camera, viewport, dock, nearEdge, { sizeWaived: true })).not.toBeNull();
    const aboveDock = pointTarget(0.5, 0.4 + (viewport.height / 2 - dock.bottom - 20) / camera.zoom, margin);
    expect(cameraForTarget(camera, viewport, dock, aboveDock, { sizeWaived: true })).not.toBeNull();
  });

  it('a point target only ever pans, at the current zoom', () => {
    const next = cameraForTarget(camera, viewport, dock, pointTarget(0.9, 0.5, 60), { sizeWaived: true })!;
    expect(next.zoom).toBe(camera.zoom);
  });

  it('takes the short way round the antimeridian', () => {
    const cam = { x: 0.99, y: 0.4, zoom: HOME * 8 };
    const next = cameraForTarget(cam, viewport, dock, pointTarget(0.02, 0.4, 60), { sizeWaived: true });
    // 0.02 is 0.03 to the right of 0.99 across the seam, well inside the view: nothing to do
    expect(next).toBeNull();
  });
});

describe('mainlandBox', () => {
  let world: Awaited<ReturnType<typeof import('~/lib/map/topology').buildWorld>>;
  beforeAll(async () => {
    (globalThis as { Path2D?: unknown }).Path2D ??= class { moveTo() {} lineTo() {} closePath() {} };
    const { buildWorld } = await import('~/lib/map/topology');
    const data = JSON.parse(readFileSync(join(process.cwd(), 'public/data/geography/world.json'), 'utf8')) as WorldData;
    world = buildWorld(data);
  });
  const lonSpan = (iso3: string) => {
    const b = mainlandBox(world.byIso3.get(iso3)!)!;
    return (b.x1 - b.x0) * 360;
  };

  it('drops remote exclaves — France is Europe, not the Atlantic to French Guiana', () => {
    const b = mainlandBox(world.byIso3.get('FRA')!)!;
    expect(lonSpan('FRA')).toBeLessThan(20);
    expect(b.x0).toBeLessThan(lonToX(0)); // Brittany
    expect(b.y0).toBeGreaterThan(latToY(52)); // nothing north of the Channel coast
  });

  it('keeps an archipelago whole — Japan spans its main islands', () => {
    expect(lonSpan('JPN')).toBeGreaterThan(10);
  });

  it('gives every country a box', () => {
    for (const f of world.features) expect(mainlandBox(f), f.country.iso3).not.toBeNull();
  });
});
