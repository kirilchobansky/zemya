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
  cameraForTarget, mainlandBox, NO_INSETS, NO_SHAPE_ZOOM_FACTOR, QUIZ_COMFORT_MARGIN, QUIZ_FRAME_PADDING,
  QUIZ_MIN_TARGET_PX, quizMinTargetPx, type FollowTarget
} from '~/lib/map/follow';
import { latToY, lonToX } from '~/lib/map/projection';
import { CAPITAL_MIN_SHAPE_WIDTH, CAPITAL_RING_DIAMETER, PIN_MAX_WIDTH } from '~/lib/map/thresholds';
import type { WorldData } from '~/lib/map/types';

const viewport = { width: 1000, height: 800 };
const HOME = homeZoom(viewport);
const dock = { ...NO_INSETS, bottom: 120 };
const options = { noShapeZoom: HOME * NO_SHAPE_ZOOM_FACTOR };

/** A country-like box `wPx` x `hPx` on screen at `zoom`, centred on (cx, cy) unit coords. */
const box = (cx: number, cy: number, wPx: number, hPx: number, zoom: number): FollowTarget => ({
  box: { x0: cx - wPx / 2 / zoom, x1: cx + wPx / 2 / zoom, y0: cy - hPx / 2 / zoom, y1: cy + hPx / 2 / zoom },
  focus: { x: cx, y: cy }, fit: true, marginPx: 12, minWidthPx: QUIZ_MIN_TARGET_PX
});
/** A capital dot on a country of the given on-screen width: only the dot has to be in view. */
const dot = (ux: number, uy: number, countryWPx: number, zoom: number, margin = 60): FollowTarget => ({
  box: { x0: ux - countryWPx / 2 / zoom, x1: ux + countryWPx / 2 / zoom, y0: uy - 0.001, y1: uy + 0.001 },
  focus: { x: ux, y: uy }, fit: false, marginPx: margin, minWidthPx: quizMinTargetPx(true)
});

describe('cameraForTarget', () => {
  const camera = { x: 0.5, y: 0.4, zoom: HOME * 8 };

  it('leaves the camera completely alone when the target is comfortably in view and big enough', () => {
    expect(cameraForTarget(camera, viewport, dock, box(0.5, 0.4, 120, 90, camera.zoom), options)).toBeNull();
  });

  it('pans at the SAME zoom when the target is off screen and fits', () => {
    const target = box(0.5 + 1500 / camera.zoom, 0.4, 120, 90, camera.zoom); // 1500 px to the right
    const next = cameraForTarget(camera, viewport, dock, target, options)!;
    expect(next.zoom).toBe(camera.zoom);
    expect(next.x).toBeGreaterThan(camera.x);
  });

  it('centres the target in the VISIBLE area, not the canvas — above the dock', () => {
    const cy = 0.4 + 900 / camera.zoom; // off the bottom as well as far right, so both axes are recentred
    const target = box(0.5 + 1500 / camera.zoom, cy, 120, 90, camera.zoom);
    const next = cameraForTarget(camera, viewport, dock, target, options)!;
    const sy = viewport.height / 2 + (cy - next.y) * next.zoom;
    expect(sy).toBeCloseTo((0 + (viewport.height - dock.bottom)) / 2, 5);
  });

  it('treats a target merely TOUCHING or near an edge as not visible — it needs a comfortable margin', () => {
    const margin = QUIZ_COMFORT_MARGIN * viewport.width;
    // fully on canvas, 20 px from the right edge: the old 12 px test called this visible
    const near = box(0.5 + (viewport.width / 2 - 20 - 50) / camera.zoom, 0.4, 100, 60, camera.zoom);
    expect(cameraForTarget(camera, viewport, dock, near, options)).not.toBeNull();
    // just inside the comfort margin: fine
    const ok = box(0.5 + (viewport.width / 2 - margin - 5 - 50) / camera.zoom, 0.4, 100, 60, camera.zoom);
    expect(cameraForTarget(camera, viewport, dock, ok, options)).toBeNull();
  });

  it('treats a target hidden under the dock as NOT visible', () => {
    const y = 0.4 + (viewport.height / 2 - 60) / camera.zoom; // inside the 120 px dock band
    expect(cameraForTarget(camera, viewport, NO_INSETS, box(0.5, y, 100, 30, camera.zoom), options)).not.toBeNull(); // still near the edge
    expect(cameraForTarget(camera, viewport, dock, box(0.5, y, 100, 30, camera.zoom), options)).not.toBeNull();
    const middle = box(0.5, 0.4 - 100 / camera.zoom, 100, 30, camera.zoom);
    expect(cameraForTarget(camera, viewport, dock, middle, options)).toBeNull();
  });

  it('treats a target beyond the canvas (where the panel starts) as not visible', () => {
    const behindPanel = box(0.5 + (viewport.width / 2 + 200) / camera.zoom, 0.4, 100, 60, camera.zoom);
    expect(cameraForTarget(camera, viewport, dock, behindPanel, options)).not.toBeNull();
  });

  it('zooms out the MINIMUM to fit a target too big for the view, and never in', () => {
    const big = box(0.5, 0.4, 3000, 1500, camera.zoom);
    const next = cameraForTarget(camera, viewport, dock, big, options)!;
    expect(next.zoom).toBeLessThan(camera.zoom);
    expect(next.zoom).toBeGreaterThan(HOME); // not a jump to the world view
    const wUnit = big.box!.x1 - big.box!.x0, hUnit = big.box!.y1 - big.box!.y0;
    const fit = Math.min((viewport.width * QUIZ_FRAME_PADDING) / wUnit, ((viewport.height - dock.bottom) * QUIZ_FRAME_PADDING) / hUnit);
    expect(next.zoom).toBeCloseTo(fit, 6);
  });

  it('GUARANTEES a minimum size: a micro-state zooms IN until it is legible, even from the world view', () => {
    const world = { x: 0.5, y: 0.4, zoom: HOME };
    const micro = box(0.52, 0.4, 3, 3, world.zoom); // 3 px wide at the overview
    const next = cameraForTarget(world, viewport, dock, micro, options)!;
    expect(next.zoom).toBeGreaterThan(world.zoom);
    const widthPx = (micro.box!.x1 - micro.box!.x0) * next.zoom;
    expect(widthPx).toBeCloseTo(QUIZ_MIN_TARGET_PX, 6);
    // ...and centres it, so it is not left at the edge of the new, closer view
    const sx = viewport.width / 2 + (0.52 - next.x) * next.zoom;
    expect(sx).toBeCloseTo(viewport.width / 2, 5);
  });

  it('leaves a country that is already legible at the overview alone (no needless zoom)', () => {
    const world = { x: 0.5, y: 0.4, zoom: HOME };
    expect(cameraForTarget(world, viewport, dock, box(0.5, 0.35, QUIZ_MIN_TARGET_PX + 4, 40, world.zoom), options)).toBeNull();
  });

  it('a country with no geometry at all gets neighbourhood zoom, since it has no width to guarantee', () => {
    const vatican: FollowTarget = { box: null, focus: { x: 0.53, y: 0.3 }, fit: false, marginPx: 48, minWidthPx: QUIZ_MIN_TARGET_PX };
    const next = cameraForTarget({ x: 0.5, y: 0.4, zoom: HOME }, viewport, dock, vatican, options)!;
    expect(next.zoom).toBe(HOME * NO_SHAPE_ZOOM_FACTOR);
  });

  it('a capital dot needs a comfortable margin: inside is fine, hugging an edge is not', () => {
    const inside = dot(0.5, 0.4, 200, camera.zoom);
    expect(cameraForTarget(camera, viewport, dock, inside, options)).toBeNull();
    const nearEdge = dot(0.5 + (viewport.width / 2 - 20) / camera.zoom, 0.4, 200, camera.zoom); // 20 px from the right edge
    expect(cameraForTarget(camera, viewport, dock, nearEdge, options)).not.toBeNull();
    const aboveDock = dot(0.5, 0.4 + (viewport.height / 2 - dock.bottom - 20) / camera.zoom, 200, camera.zoom);
    expect(cameraForTarget(camera, viewport, dock, aboveDock, options)).not.toBeNull();
  });

  it('a capital dot on a big country only pans, but on a micro-state the size rule still zooms in', () => {
    const pan = cameraForTarget(camera, viewport, dock, dot(0.9, 0.5, 200, camera.zoom), options)!;
    expect(pan.zoom).toBe(camera.zoom);
    const micro = cameraForTarget({ ...camera, zoom: HOME }, viewport, dock, dot(0.5, 0.4, 2, HOME), options)!;
    expect(micro.zoom).toBeGreaterThan(HOME);
  });

  it('centres only the axis that failed', () => {
    const highUp = box(0.5, 0.4 - (viewport.height / 2 - 30) / camera.zoom, 100, 40, camera.zoom); // fine sideways, hugging the top
    const next = cameraForTarget(camera, viewport, dock, highUp, options)!;
    expect(next.x).toBe(camera.x);
    expect(next.y).not.toBe(camera.y);
  });

  it('takes the short way round the antimeridian', () => {
    const cam = { x: 0.99, y: 0.4, zoom: HOME * 8 };
    // 0.02 is 0.03 to the right of 0.99 across the seam, well inside the view: nothing to do
    expect(cameraForTarget(cam, viewport, dock, dot(0.02, 0.4, 200, cam.zoom), options)).toBeNull();
  });
});

describe('the thresholds are related, not independent', () => {
  it('a capital ring needs a country wider than a pin by the ring\'s own diameter', () => {
    expect(CAPITAL_MIN_SHAPE_WIDTH).toBe(PIN_MAX_WIDTH + CAPITAL_RING_DIAMETER);
    expect(CAPITAL_MIN_SHAPE_WIDTH).toBeGreaterThan(PIN_MAX_WIDTH);
  });
  it('the quiz never leaves a target as a pin, and never smaller than a capital ring can sit on', () => {
    expect(QUIZ_MIN_TARGET_PX).toBeGreaterThan(PIN_MAX_WIDTH);
    expect(quizMinTargetPx(false)).toBeGreaterThan(PIN_MAX_WIDTH);
    expect(quizMinTargetPx(true)).toBeGreaterThanOrEqual(CAPITAL_MIN_SHAPE_WIDTH);
  });
  it('the framing padding is exactly what the comfort margin leaves', () => {
    expect(QUIZ_FRAME_PADDING).toBeCloseTo(1 - 2 * QUIZ_COMFORT_MARGIN, 12);
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
