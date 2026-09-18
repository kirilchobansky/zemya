/**
 * Canvas renderer.
 *
 * The whole frame is: set one transform, fill 240 cached Path2D objects, stroke them,
 * then draw pins and labels in screen space. No per-frame geometry work.
 *
 * The world is drawn three times side by side (offset −1, 0, +1 world widths) while
 * zoomed out, which is what makes horizontal panning wrap seamlessly. Once a single world
 * is wider than the viewport the copies are dropped.
 */
import type { CameraState, Viewport } from './camera';
import { homeZoom, worldToScreen } from './camera';
import { kmPerPixel, wrapX, yToLat, lonToX, latToY } from './projection';
import type { Feature, World } from './types';

export interface Style {
  /** Fill for a country, or null to skip drawing it entirely. */
  fill(feature: Feature): string | null;
  /** [colour, width in CSS pixels], or null for no stroke. */
  stroke(feature: Feature): [string, number] | null;
  /** Extra outline dragged over the map by the size-comparison tool. */
  overlay?: { path: Path2D; fill: string; stroke: string } | null;
  showLabels: boolean;
  showPins: boolean;
  /**
   * True for the whole lifetime of a quiz run. Suppresses every surface that could hand
   * over the answer: no country labels here (see drawLabels below); the hover tooltip,
   * the search box and the default neighbour-glow are suppressed at their call sites in
   * app/routes/atlas.tsx, gated on this same flag. One name for all four, so a fifth
   * surface that shows a country name has one obvious place to check — see CLAUDE.md's
   * Quizzes section.
   */
  quizMode?: boolean;
}

export const COLORS = {
  ocean: '#080D13',
  context: '#16222D',
  graticule: 'rgba(78,169,201,.075)',
  graticuleMajor: 'rgba(78,169,201,.16)',
  land: '#31485A',
  microPin: '#68889D',
  labelHalo: 'rgba(8,13,19,.85)',
  labelText: 'rgba(230,238,243,.9)',
  pinEdge: 'rgba(8,13,19,.9)'
} as const;

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  camera: CameraState;
  viewport: Viewport;
  dpr: number;
}

function applyTransform(rc: RenderContext, copy: number): void {
  const { ctx, camera, viewport, dpr } = rc;
  const x = wrapX(camera.x);
  ctx.setTransform(
    camera.zoom * dpr, 0, 0, camera.zoom * dpr,
    (viewport.width / 2 - x * camera.zoom + copy * camera.zoom) * dpr,
    (viewport.height / 2 - camera.y * camera.zoom) * dpr
  );
}

function resetTransform(rc: RenderContext): void {
  rc.ctx.setTransform(rc.dpr, 0, 0, rc.dpr, 0, 0);
}

function graticuleStep(zoom: number, home: number): number {
  if (zoom > home * 30) return 1;
  if (zoom > home * 10) return 5;
  if (zoom > home * 3) return 10;
  return 30;
}

function drawGraticule(rc: RenderContext): void {
  const { ctx, camera, viewport } = rc;
  resetTransform(rc);
  const step = graticuleStep(camera.zoom, homeZoom(viewport));

  ctx.strokeStyle = COLORS.graticule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let lat = -80; lat <= 80; lat += step) {
    const [, y] = worldToScreen(camera, viewport, 0, latToY(lat));
    if (y < -20 || y > viewport.height + 20) continue;
    ctx.moveTo(0, y);
    ctx.lineTo(viewport.width, y);
  }
  for (let lon = -180; lon < 180; lon += step) {
    const [x] = worldToScreen(camera, viewport, lonToX(lon), 0);
    if (x < -20 || x > viewport.width + 20) continue;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, viewport.height);
  }
  ctx.stroke();

  ctx.strokeStyle = COLORS.graticuleMajor;
  ctx.beginPath();
  const [, equator] = worldToScreen(camera, viewport, 0, latToY(0));
  ctx.moveTo(0, equator);
  ctx.lineTo(viewport.width, equator);
  const [prime] = worldToScreen(camera, viewport, lonToX(0), 0);
  ctx.moveTo(prime, 0);
  ctx.lineTo(prime, viewport.height);
  ctx.stroke();
}

/** Small buffer, in CSS px, so a copy or a feature that's only just off-screen doesn't
 *  pop into view a frame late during a fast pan. */
const CULL_MARGIN_PX = 120;

/**
 * Does this copy's world tile land anywhere near the viewport? At world zoom the -1/+1
 * copies (used so panning across the ±180° seam looks continuous — see applyTransform)
 * are almost entirely off screen, and were being filled/stroked in full regardless.
 * Real content can overflow a copy's nominal [0,1] unit-square tile slightly (Russia's
 * Chukotka crossing lands past x=1 — see topology.ts's unwrapRing), which the margin
 * comfortably covers: multi-copy rendering only happens near world zoom (see render()),
 * where 120px is a small fraction of the zoom-sized tile.
 */
function isCopyVisible(rc: RenderContext, copy: number): boolean {
  const { camera, viewport } = rc;
  const left = viewport.width / 2 + camera.zoom * (copy - wrapX(camera.x));
  return left < viewport.width + CULL_MARGIN_PX && left + camera.zoom > -CULL_MARGIN_PX;
}

/** Does this feature's bbox land anywhere near the viewport, in this copy's transform?
 *  Same margin and reasoning as isCopyVisible. A feature with no bbox is never reached
 *  here — the caller already skips anything with no path to draw. */
function isFeatureVisible(rc: RenderContext, feature: Feature, copy: number): boolean {
  const bbox = feature.bbox;
  if (!bbox) return true;
  const { camera, viewport } = rc;
  const x = wrapX(camera.x);
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const left = viewport.width / 2 + camera.zoom * (lonToX(minLon) - x + copy);
  const right = viewport.width / 2 + camera.zoom * (lonToX(maxLon) - x + copy);
  const top = viewport.height / 2 + camera.zoom * (latToY(maxLat) - camera.y);
  const bottom = viewport.height / 2 + camera.zoom * (latToY(minLat) - camera.y);
  return (
    right > -CULL_MARGIN_PX && left < viewport.width + CULL_MARGIN_PX &&
    bottom > -CULL_MARGIN_PX && top < viewport.height + CULL_MARGIN_PX
  );
}

/** Below this on-screen width, in CSS pixels, a country draws as a pin instead of its
 *  real shape — a per-frame decision from the current zoom, not a fixed property of the
 *  country. Tune by looking at the result: too low and micro-states are unclickable
 *  slivers before they're worth drawing as shapes; too high and mid-size islands stay
 *  pins longer than they should. */
const PIN_MAX_WIDTH = 7;

/** A feature's on-screen width in CSS pixels at the current zoom, from its (unwrapped,
 *  already-consistent — see topology.ts) bbox. A feature with no bbox at all has no
 *  shape to draw at any zoom, so it is always a pin. */
function onScreenWidth(feature: Feature, camera: CameraState): number {
  if (!feature.bbox) return 0;
  const [minLon, , maxLon] = feature.bbox;
  return (lonToX(maxLon) - lonToX(minLon)) * camera.zoom;
}

/** Whether this feature draws as a pin THIS FRAME. Never both a pin and a shape, and
 *  never neither — renderer, hit-testing and labelling all call this so they can't
 *  disagree with each other. */
function drawsAsPin(feature: Feature, camera: CameraState): boolean {
  if (!feature.path) return true;
  return onScreenWidth(feature, camera) < PIN_MAX_WIDTH;
}

/** How much bigger the quiz's current target draws as a pin, plus a halo ring outside
 *  it — the quiz keeps the camera at (roughly) the world view rather than zooming in
 *  (see CLAUDE.md's Quizzes section), so a country too small to draw as a shape needs a
 *  pin that reads at a glance, not the same small dot every other pin gets. */
const QUIZ_FOCUS_PIN_RADIUS = 9;
const QUIZ_FOCUS_RING_GAP = 7;

function drawPins(rc: RenderContext, world: World, style: Style, focus: Set<Feature>): void {
  const { ctx, camera, viewport } = rc;
  for (const feature of world.features) {
    if (!drawsAsPin(feature, camera)) continue;
    const colour = style.fill(feature);
    if (!colour) continue;
    const [x, y] = worldToScreen(camera, viewport, feature.ux, feature.uy);
    if (x < -14 || x > viewport.width + 14 || y < -14 || y > viewport.height + 14) continue;

    const inFocus = focus.has(feature);
    const isQuizTarget = Boolean(style.quizMode) && inFocus;
    const radius = isQuizTarget ? QUIZ_FOCUS_PIN_RADIUS : inFocus ? 6.5 : 4.2;
    const fillColour = colour === COLORS.land ? COLORS.microPin : colour;

    if (isQuizTarget) {
      ctx.beginPath();
      ctx.arc(x, y, radius + QUIZ_FOCUS_RING_GAP, 0, Math.PI * 2);
      ctx.strokeStyle = fillColour;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fillColour;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = COLORS.pinEdge;
    ctx.stroke();
  }
}

/** Minimum on-screen width, in pixels, before a country is worth labelling. */
const LABEL_MIN_WIDTH = 46;

function drawLabels(rc: RenderContext, world: World, font: string, quizMode: boolean): void {
  if (quizMode) return; // a label at the quiz's framing would print the answer
  const { ctx, camera, viewport } = rc;
  if (camera.zoom < homeZoom(viewport) * 1.4) return;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const placed: [number, number, number][] = [];
  const candidates = world.features
    .filter(f => f.bbox)
    .sort((a, b) => b.country.area - a.country.area);

  for (const feature of candidates) {
    const box = feature.bbox!;
    const widthPx = (lonToX(box[2]) - lonToX(box[0])) * camera.zoom;
    if (widthPx < LABEL_MIN_WIDTH) continue;

    const [x, y] = worldToScreen(camera, viewport, feature.ux, feature.uy);
    if (x < 0 || x > viewport.width || y < 0 || y > viewport.height) continue;

    const size = Math.max(10, Math.min(14, widthPx / 7));
    ctx.font = `500 ${size}px ${font}`;
    const textWidth = ctx.measureText(feature.country.name).width;
    if (textWidth > widthPx * 1.05) continue;

    let clashes = false;
    for (const [px, py, pw] of placed) {
      if (Math.abs(px - x) < (pw + textWidth) / 2 + 6 && Math.abs(py - y) < 15) {
        clashes = true;
        break;
      }
    }
    if (clashes) continue;
    placed.push([x, y, textWidth]);

    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.labelHalo;
    ctx.strokeText(feature.country.name, x, y);
    ctx.fillStyle = COLORS.labelText;
    ctx.fillText(feature.country.name, x, y);
  }
}

export function render(
  rc: RenderContext,
  world: World,
  style: Style,
  focus: Set<Feature>,
  uiFont: string
): void {
  const { ctx, camera, viewport } = rc;

  resetTransform(rc);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = COLORS.ocean;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  drawGraticule(rc);

  const copyCandidates = camera.zoom < viewport.width * 1.6 ? [-1, 0, 1] : [0];
  // copy 0 always renders even if the visibility maths somehow says otherwise — it must
  // never be possible to cull the map down to a blank canvas
  const copies = copyCandidates.filter(copy => copy === 0 || isCopyVisible(rc, copy));

  for (const copy of copies) {
    applyTransform(rc, copy);
    ctx.lineJoin = 'round';

    ctx.fillStyle = COLORS.context;
    for (const shape of world.context) ctx.fill(shape.path);

    // Computed once per copy and reused for both passes below — same bbox test the pin
    // logic already needs (onScreenWidth), just against the viewport instead of a pixel
    // threshold. A frame is pixel-identical to drawing every feature unconditionally:
    // nothing visible is skipped, only work for shapes nowhere near the viewport.
    const visible = world.features.filter(
      feature => feature.path && !drawsAsPin(feature, camera) && isFeatureVisible(rc, feature, copy)
    );

    for (const feature of visible) {
      const colour = style.fill(feature);
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fill(feature.path!);
    }

    // strokes in a second pass so no fill can bleed over a neighbour's border
    for (const feature of visible) {
      const s = style.stroke(feature);
      if (!s) continue;
      ctx.strokeStyle = s[0];
      ctx.lineWidth = s[1] / camera.zoom;
      ctx.stroke(feature.path!);
    }

    // lakes on top of the land they cut into, so the Caspian reads as water sitting in
    // Kazakhstan/Russia rather than a hole through to the page background
    ctx.fillStyle = COLORS.ocean;
    for (const lake of world.lakes) ctx.fill(lake.path);

    if (style.overlay) {
      ctx.fillStyle = style.overlay.fill;
      ctx.fill(style.overlay.path);
      ctx.strokeStyle = style.overlay.stroke;
      ctx.lineWidth = 1.6 / camera.zoom;
      ctx.stroke(style.overlay.path);
    }
  }

  resetTransform(rc);
  if (style.showPins) drawPins(rc, world, style, focus);
  if (style.showLabels) drawLabels(rc, world, uiFont, Boolean(style.quizMode));
}

/** Nearest round distance that fits in roughly 90 px, for the scale bar. */
export function scaleBar(camera: CameraState, viewport: Viewport): { km: number; px: number } {
  const km = kmPerPixel(yToLat(camera.y), camera.zoom);
  const target = km * 90;
  const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
  const nice = [1, 2, 5, 10].map(m => m * magnitude).find(v => v >= target) ?? magnitude * 10;
  return { km: nice, px: nice / km };
}

/**
 * Which country is under this screen point.
 *
 * Pins are tested first because they sit on top of whatever they overlap — but only the
 * ones actually drawn as pins this frame (drawsAsPin() is the same per-frame decision the
 * renderer just made, not the static `tiny` flag). Whatever wasn't a pin was a real shape,
 * so it's hit-tested as one with `isPointInPath`, which takes screen coordinates and
 * applies the current transform to the path — the same transform used to draw is the one
 * that decides hits, so the two can never disagree.
 */
export function pick(
  rc: RenderContext,
  world: World,
  sx: number,
  sy: number,
  pinRadius = 9
): Feature | null {
  const { ctx, camera, viewport, dpr } = rc;

  let nearestPin: Feature | null = null;
  let nearestDistance = pinRadius;
  for (const feature of world.features) {
    if (!drawsAsPin(feature, camera)) continue;
    const [x, y] = worldToScreen(camera, viewport, feature.ux, feature.uy);
    const distance = Math.hypot(x - sx, y - sy);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPin = feature;
    }
  }
  if (nearestPin) return nearestPin;

  const px = sx * dpr;
  const py = sy * dpr;
  for (const copy of [0, -1, 1]) {
    applyTransform(rc, copy);
    for (const feature of world.features) {
      if (!feature.path || drawsAsPin(feature, camera)) continue;
      if (ctx.isPointInPath(feature.path, px, py)) {
        resetTransform(rc);
        return feature;
      }
    }
  }
  resetTransform(rc);
  return null;
}

/** Is this screen point inside the dragged comparison outline? */
export function hitOverlay(rc: RenderContext, path: Path2D, sx: number, sy: number): boolean {
  const { ctx, dpr } = rc;
  for (const copy of [0, -1, 1]) {
    applyTransform(rc, copy);
    if (ctx.isPointInPath(path, sx * dpr, sy * dpr)) {
      resetTransform(rc);
      return true;
    }
  }
  resetTransform(rc);
  return false;
}
