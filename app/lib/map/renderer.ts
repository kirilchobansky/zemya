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
import type { Feature, PlaceMark, World } from './types';
import {
  CAPITAL_MIN_SHAPE_WIDTH, CAPITAL_RING_HALO, CAPITAL_RING_RADIUS, CAPITAL_ZOOM_FACTOR, capitalRevealFactor, PIN_MAX_WIDTH
} from './thresholds';

export interface Style {
  /** Fill for a country, or null to skip drawing it entirely. */
  fill(feature: Feature): string | null;
  /** [colour, width in CSS pixels], or null for no stroke. */
  stroke(feature: Feature): [string, number] | null;
  /** Whether this feature keeps its stroke during a fast frame (atlas.ts's gesture/fly-to
   *  mode) — normally the selected country and its neighbours. Ignored outside a fast
   *  frame, where every feature strokes as usual. Omit to stroke nothing during one. */
  highlight?(feature: Feature): boolean;
  /** Extra outline dragged over the map by the size-comparison tool. */
  overlay?: { path: Path2D; fill: string; stroke: string } | null;
  showLabels: boolean;
  showPins: boolean;
  /** The capitals layer: a ring per capital city once zoomed in past
   *  CAPITAL_ZOOM_FACTOR (or later, for a small country), together with its name. Off if omitted. */
  showCapitals?: boolean;
  /** The one capital the capitals quiz is asking about: drawn with the quiz-target ring at
   *  ANY zoom, and only under quizMode (every other capital ring stays hidden there). It
   *  carries no name — labels and tooltips stay suppressed, so the ring is a question, not
   *  an answer. */
  quizPlace?: PlaceMark | null;
  /**
   * True for the whole lifetime of a quiz run. Suppresses every surface that could hand
   * over the answer: no country labels and no place (capital) labels or dots here (see
   * drawLabels and capitalsVisible below); the hover tooltip — country AND place — the
   * search box and the default neighbour-glow are suppressed at their call sites in
   * app/routes/atlas.tsx and app/lib/map/atlas.ts, gated on this same flag. One name for
   * all of them, so a further surface that shows a name has one obvious place to check —
   * see CLAUDE.md's Quizzes section.
   */
  quizMode?: boolean;
}

/**
 * Every colour the canvas paints, resolved from app/styles/tokens.css. A canvas
 * fillStyle/strokeStyle can't be `var(--x)`, so these start as the tokens' dark-theme
 * defaults (kept in sync by hand — see tokens.css's own header note) and are only ever
 * overwritten by refreshMapColours() below, never read fresh inside the render loop.
 */
export const COLORS = {
  ocean: '#080D13',
  context: '#16222D',
  graticule: 'rgba(78,169,201,.075)',
  graticuleMajor: 'rgba(78,169,201,.16)',
  land: '#31485A',
  microPin: '#68889D',
  labelHalo: 'rgba(8,13,19,.85)',
  labelText: 'rgba(230,238,243,.9)',
  pinEdge: 'rgba(8,13,19,.9)',
  capital: 'rgba(230,238,243,.95)',
  capitalHalo: 'rgba(8,13,19,.85)',
  capitalLabelText: 'rgba(159,179,192,1)',
  /** The pulse ring's colour, at whatever alpha the pulse's own animation wants — kept as a
   *  bare "r,g,b" triplet rather than a full colour for that reason (see drawPulse). */
  pulseRgb: '232,163,61',
  /** The size-comparison drag overlay (atlas.ts's compare state) — brass, so it reads as
   *  the same accent the rest of the "selected" language uses. */
  compareFill: 'rgba(232,163,61,.42)',
  compareStroke: '#F5CE86'
};

/**
 * Re-reads every entry in COLORS from tokens.css and caches it in place — called once from
 * app/routes/atlas.tsx before the first frame and again on every theme change, never from
 * inside render(). getComputedStyle is real work; a canvas frame can't afford it 60 times a
 * second, which is the whole reason COLORS is a cache rather than a live lookup.
 */
export function refreshMapColours(): void {
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string) => cs.getPropertyValue(name).trim();
  const rgb = (name: string) => read(name).replace(/\s+/g, ',');
  const abyssRgb = rgb('--abyss-rgb');
  const seaRgb = rgb('--sea-rgb');
  const inkRgb = rgb('--ink-rgb');

  COLORS.ocean = read('--ocean');
  COLORS.context = read('--map-context');
  COLORS.graticule = `rgba(${seaRgb},${read('--graticule-alpha')})`;
  COLORS.graticuleMajor = `rgba(${seaRgb},${read('--graticule-major-alpha')})`;
  COLORS.land = read('--land');
  COLORS.microPin = read('--micro-pin');
  COLORS.labelHalo = `rgba(${abyssRgb},.85)`;
  COLORS.labelText = `rgba(${inkRgb},.9)`;
  COLORS.pinEdge = `rgba(${abyssRgb},.9)`;
  COLORS.capital = `rgba(${inkRgb},.95)`;
  COLORS.capitalHalo = `rgba(${abyssRgb},.85)`;
  COLORS.capitalLabelText = read('--ink-2');
  COLORS.pulseRgb = rgb('--brass-rgb');
  COLORS.compareFill = `rgba(${COLORS.pulseRgb},.42)`;
  COLORS.compareStroke = read('--brass-2');
}

/**
 * A one-shot ring that grows out of a point and fades, marking a NEW quiz target so it can
 * be found among 197 shapes. `t` runs 0 -> 1 over the pulse. Purely a paint: it changes no
 * layout, moves no camera and swallows no input. Anchored in map space, so it stays on its
 * target while the camera pans.
 */
export interface Pulse {
  ux: number;
  uy: number;
  t: number;
}
const PULSE_START_RADIUS = 8;
const PULSE_GROWTH = 90;

function drawPulse(rc: RenderContext, pulse: Pulse): void {
  const { ctx, camera, viewport } = rc;
  const [x, y] = worldToScreen(camera, viewport, pulse.ux, pulse.uy);
  const eased = 1 - Math.pow(1 - pulse.t, 3); // fast out, slow finish
  ctx.beginPath();
  ctx.arc(x, y, PULSE_START_RADIUS + PULSE_GROWTH * eased, 0, Math.PI * 2);
  ctx.lineWidth = 3.5 - 2 * pulse.t;
  ctx.strokeStyle = `rgba(${COLORS.pulseRgb},${(0.9 * (1 - pulse.t)).toFixed(3)})`;
  ctx.stroke();
}

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  camera: CameraState;
  viewport: Viewport;
  dpr: number;
  /** True during a coarse-pointer gesture or fly-to (atlas.ts) — one frame's worth of
   *  degradation (see the FAST_FRAME_* constants below `render()`), never used by
   *  pick()/pickPlace()/hitOverlay(), which always hit-test the real geometry. Optional
   *  (treated as false) so existing RenderContext literals that predate this flag still
   *  typecheck. */
  fast?: boolean;
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

/* PIN_MAX_WIDTH, the capital ring's size and CAPITAL_MIN_SHAPE_WIDTH live in thresholds.ts,
   shared with the quiz camera (follow.ts) and tied to each other there. */

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
export function drawsAsPin(feature: Feature, camera: CameraState): boolean {
  if (!feature.path && !feature.fullPath) return true;
  return onScreenWidth(feature, camera) < PIN_MAX_WIDTH;
}

/**
 * Below this zoom (a multiple of homeZoom, the zoom at which the whole world fills the
 * viewport), the map renders from the coarse payload — full 1:10m coastline is sub-pixel
 * at world zoom, so rasterising it costs real frame time to show detail nobody can see.
 * 4x was chosen by zooming in slowly and watching for the switch — it must not be visible
 * as a jump; tune by looking, the same way PIN_MAX_WIDTH above was. See CLAUDE.md's
 * Performance section.
 */
const LOD_ZOOM_FACTOR = 4;

function useFullDetail(camera: CameraState, viewport: Viewport): boolean {
  return camera.zoom >= homeZoom(viewport) * LOD_ZOOM_FACTOR;
}

/** Whichever detail level is both loaded and appropriate for the current zoom — full only
 *  above the LOD threshold AND once world.json has actually attached (attachFullDetail),
 *  coarse otherwise. Renderer and pick() share this so a click can never hit-test against
 *  a different shape than what's on screen. */
function activePath(feature: Feature, full: boolean): Path2D | null {
  return full && feature.fullPath ? feature.fullPath : feature.path;
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

/**
 * A capital's ring AND its name appear together, when all of these hold (thresholds.ts):
 *  1. zoom >= CAPITAL_ZOOM_FACTOR x homeZoom (9x) — the old label threshold; the ring used to
 *     come earlier (6x) and read as an unlabelled dot.
 *  2. the country is drawn as a real SHAPE this frame, at least CAPITAL_MIN_SHAPE_WIDTH wide.
 *  3. zoom >= capitalRevealFactor(area, lat): small countries wait until their equivalent square
 *     is CAPITAL_REVEAL_SIDE_PX across — Cyprus and Jamaica a few doublings after 9x, Liechtenstein,
 *     Malta, the Maldives and the Caribbean islands much later, Vatican City never (its geometry
 *     is degenerate; the pin stands in).
 * Chosen by looking, zooming into Central Europe and the Caribbean in a real browser.
 */
const CAPITAL_PICK_RADIUS = 7;

/** Whether the capitals layer draws (and can be hovered or clicked) this frame. quizMode
 *  is a hard veto: a capital's ring is not an answer, but the hover tooltip and label that
 *  come with it are, and one predicate for all three means they cannot disagree. */
export function capitalsVisible(
  style: Pick<Style, 'showCapitals' | 'quizMode'>,
  camera: CameraState,
  viewport: Viewport
): boolean {
  return (
    Boolean(style.showCapitals) &&
    !style.quizMode &&
    camera.zoom >= homeZoom(viewport) * CAPITAL_ZOOM_FACTOR
  );
}

/** Second gate, per capital: its country is a drawn shape right now, wide enough that the ring sits
 *  on an outline rather than floating beside it (CAPITAL_MIN_SHAPE_WIDTH, derived from
 *  PIN_MAX_WIDTH — so it can never pass while the country is a pin), AND we are past the zoom its
 *  AREA calls for (capitalRevealFactor: small countries wait longer). Rings, names and
 *  hit-testing all go through this, so a ring, its name and its hover cannot disagree. */
function capitalShapeShowing(mark: PlaceMark, camera: CameraState, viewport: Viewport): boolean {
  if (drawsAsPin(mark.feature, camera) || onScreenWidth(mark.feature, camera) < CAPITAL_MIN_SHAPE_WIDTH) return false;
  const home = homeZoom(viewport);
  return camera.zoom >= home * capitalRevealFactor(mark.feature.country.area, mark.place.lat, home, mark.place.iso3);
}

/** A small hollow ring — deliberately NOT the filled circle a micro-state pin is, so the
 *  map never has two dot languages that mean different things. */
function drawCapitals(rc: RenderContext, world: World, style: Style): void {
  const { ctx, camera, viewport } = rc;
  if (style.quizMode) {
    if (style.quizPlace) drawQuizPlace(rc, style.quizPlace, style);
    return;
  }
  if (!capitalsVisible(style, camera, viewport)) return;
  for (const mark of world.places) {
    const [x, y] = worldToScreen(camera, viewport, mark.ux, mark.uy);
    if (x < -10 || x > viewport.width + 10 || y < -10 || y > viewport.height + 10) continue;
    if (!capitalShapeShowing(mark, camera, viewport)) continue;
    ctx.beginPath();
    ctx.arc(x, y, CAPITAL_RING_RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = CAPITAL_RING_HALO * 2;
    ctx.strokeStyle = COLORS.capitalHalo;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS.capital;
    ctx.stroke();
  }
}

/** The quiz-target ring for a capital: bigger than a normal ring plus an outer halo, for
 *  the same reason the target's pin gets one (QUIZ_FOCUS_PIN_RADIUS) — the quiz keeps the
 *  camera near the world view, where a normal 3 px ring would be nearly invisible. Drawn
 *  in ink, not brass: the target country underneath is already brass. */
const QUIZ_RING_RADIUS = 5;
const QUIZ_RING_HALO_GAP = 6;

function drawQuizPlace(rc: RenderContext, mark: PlaceMark, style: Style): void {
  const { ctx, camera, viewport } = rc;
  const [x, y] = worldToScreen(camera, viewport, mark.ux, mark.uy);
  if (x < -20 || x > viewport.width + 20 || y < -20 || y > viewport.height + 20) return;
  // a country still drawn as a pin carries its own ring and halo (drawPins); a second ring
  // beside it is a dot floating before its country has a shape
  if (drawsAsPin(mark.feature, camera)) return;
  for (const [radius, width] of [[QUIZ_RING_RADIUS + QUIZ_RING_HALO_GAP, 2], [QUIZ_RING_RADIUS, 2.4]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.lineWidth = width + 2.4;
    ctx.strokeStyle = COLORS.capitalHalo;
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = COLORS.capital;
    ctx.stroke();
  }
}

/** Minimum on-screen width, in pixels, before a country is worth labelling. */
const LABEL_MIN_WIDTH = 46;

/**
 * A placed label, already resolved down to "what to draw and where" — nothing left that
 * needs measuring or a collision test. `ux`/`uy` is the feature/place's own anchor (so it
 * tracks a pan or pinch correctly); `dx`/`dy` is the fixed pixel offset from that anchor's
 * own screen position, chosen once (0,0 for a country name, one of four spots around a
 * capital's ring for a place name — see computeLabelLayout). Replaying a cached layout is
 * exactly this: reproject `ux,uy` with whatever camera is current, add `dx,dy`, draw.
 */
interface LabelPlacement {
  kind: 'country' | 'place';
  ux: number;
  uy: number;
  text: string;
  font: string;
  align: CanvasTextAlign;
  dx: number;
  dy: number;
}

interface LabelLayout {
  zoom: number;
  time: number;
  placements: LabelPlacement[];
}

/**
 * The last full (non-fast) label layout — measureText and the overlap test only ever run to
 * fill this in (computeLabelLayout), never per fast frame. A fast frame just reprojects it
 * (drawLabelPlacements). One cache for the whole app: there is only ever one map on screen.
 */
let cachedLabels: LabelLayout | null = null;
/** Text widths, keyed by "size:text" — measureText is the other expensive half of a full
 *  layout pass, and a country's name at a given (rounded) font size never changes, so this
 *  persists across every computeLabelLayout call, not just within one. */
const textWidthCache = new Map<string, number>();

/** A cached layout is reused during a fast frame until the zoom has drifted past this factor
 *  either way (the label SET would likely differ by then) or this many ms have passed —
 *  whichever comes first — so a long slow gesture still refreshes its labels periodically
 *  instead of freezing them for the gesture's whole duration. */
const LABEL_RELAYOUT_ZOOM_FACTOR = 1.5;
const LABEL_RELAYOUT_INTERVAL_MS = 300;

function measuredWidth(ctx: CanvasRenderingContext2D, text: string, font: string, sizeKey: number): number {
  const key = `${sizeKey}:${text}`;
  const cached = textWidthCache.get(key);
  if (cached !== undefined) return cached;
  ctx.font = font;
  const width = ctx.measureText(text).width;
  textWidthCache.set(key, width);
  return width;
}

/**
 * The expensive pass: measure every candidate label and run the overlap test, sorted by
 * area (country names) then population (capital names, filling in around whatever country
 * names already claimed) — same order and same collision rule as before, just building a
 * list of placements instead of drawing immediately, so a fast frame can replay it.
 */
function computeLabelLayout(rc: RenderContext, world: World, font: string, style: Style): LabelPlacement[] {
  const { ctx, camera, viewport } = rc;
  const placements: LabelPlacement[] = [];
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

    // rounded to the nearest px: a continuous size (widthPx/7) would almost never repeat,
    // which would defeat measuredWidth's cache — imperceptible, and PIN_MAX_WIDTH-style
    // "tune by looking" was already this rough
    const size = Math.round(Math.max(10, Math.min(14, widthPx / 7)));
    const labelFont = `500 ${size}px ${font}`;
    const textWidth = measuredWidth(ctx, feature.country.name, labelFont, size);
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
    placements.push({ kind: 'country', ux: feature.ux, uy: feature.uy, text: feature.country.name, font: labelFont, align: 'center', dx: 0, dy: 0 });
  }

  if (capitalsVisible(style, camera, viewport)) {
    const placeFont = `400 11px ${font}`;
    const placeCandidates = world.places
      .filter(mark => capitalShapeShowing(mark, camera, viewport))
      .sort((a, b) => b.place.population - a.place.population);

    for (const mark of placeCandidates) {
      const [x, y] = worldToScreen(camera, viewport, mark.ux, mark.uy);
      if (x < 0 || x > viewport.width || y < 0 || y > viewport.height) continue;

      const textWidth = measuredWidth(ctx, mark.place.name, placeFont, 11);
      // Beside the ring first; if a country name (which sits on a tiny country's centre, right where
      // its capital is) or another capital is in the way, left, then below, then above. A ring
      // without its name is the one thing this layer must not show, so it tries before giving up.
      const gap = CAPITAL_RING_RADIUS + 5;
      const spots: [number, number][] = [
        [x + gap, y],
        [x - gap - textWidth, y],
        [x - textWidth / 2, y + 17],
        [x - textWidth / 2, y - 17]
      ];
      const clashesAt = (left: number, ly: number) => {
        const centre = left + textWidth / 2; // `placed` stores centres, like the country labels
        return placed.some(([px, py, pw]) => Math.abs(px - centre) < (pw + textWidth) / 2 + 6 && Math.abs(py - ly) < 15);
      };
      const spot = spots.find(([left, ly]) => !clashesAt(left, ly));
      if (!spot) continue;
      const [left, labelY] = spot;
      placed.push([left + textWidth / 2, labelY, textWidth]);
      placements.push({
        kind: 'place', ux: mark.ux, uy: mark.uy, text: mark.place.name, font: placeFont, align: 'left',
        dx: left - x, dy: labelY - y
      });
    }
  }

  return placements;
}

/** Replays a layout: reproject each placement's own anchor with the CURRENT camera (so a
 *  cached set still tracks a pan or pinch correctly), add its fixed offset, draw. No
 *  measuring, no collision test — that's the whole point during a fast frame. */
function drawLabelPlacements(rc: RenderContext, placements: LabelPlacement[]): void {
  const { ctx, camera, viewport } = rc;
  ctx.textBaseline = 'middle';
  for (const p of placements) {
    const [ax, ay] = worldToScreen(camera, viewport, p.ux, p.uy);
    const x = ax + p.dx;
    const y = ay + p.dy;
    if (x < -CULL_MARGIN_PX || x > viewport.width + CULL_MARGIN_PX || y < -CULL_MARGIN_PX || y > viewport.height + CULL_MARGIN_PX) continue;

    ctx.font = p.font;
    ctx.textAlign = p.align;
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.labelHalo;
    ctx.strokeText(p.text, x, y);
    ctx.fillStyle = p.kind === 'country' ? COLORS.labelText : COLORS.capitalLabelText;
    ctx.fillText(p.text, x, y);
  }
}

/**
 * Country and capital names. The layout (which labels, and where) only gets recomputed —
 * measureText plus the overlap test, the expensive part — on a full (non-fast) frame, or on
 * a fast one whose cached layout has gone stale (see LABEL_RELAYOUT_*); every other fast
 * frame just reprojects the cached placements (drawLabelPlacements). Labels are drawn during
 * a gesture, unlike strokes/the graticule/full detail — they're the only way to navigate
 * while the map is moving, and this is what keeps them cheap enough to.
 */
function drawLabels(rc: RenderContext, world: World, font: string, style: Style): void {
  if (style.quizMode) return; // a label at the quiz's framing would print the answer — country OR capital
  const { camera, viewport, fast } = rc;
  if (camera.zoom < homeZoom(viewport) * 1.4) return;

  const now = performance.now();
  const stale =
    !cachedLabels ||
    camera.zoom > cachedLabels.zoom * LABEL_RELAYOUT_ZOOM_FACTOR ||
    camera.zoom < cachedLabels.zoom / LABEL_RELAYOUT_ZOOM_FACTOR ||
    now - cachedLabels.time > LABEL_RELAYOUT_INTERVAL_MS;

  if (!fast || stale) {
    cachedLabels = { zoom: camera.zoom, time: now, placements: computeLabelLayout(rc, world, font, style) };
  }
  // never null here: `stale` is true whenever cachedLabels was null, which forces the branch above
  drawLabelPlacements(rc, cachedLabels!.placements);
}

/**
 * Degradations applied only while `rc.fast` is set (a coarse-pointer gesture or fly-to in
 * progress — see atlas.ts's setGestureActive/setFlying). Grouped here, each independent, so
 * any one can be tuned or switched back on without touching the others while chasing frame
 * time. A `true` means "keep doing this during a fast frame too" — every one starts `false`
 * because the whole point is to skip it. Labels, pins and capital markers are NOT in this
 * list — they still draw every fast frame (drawLabels stays cheap on its own, via the
 * layout cache above; pins and capital rings were already cheap) because they're the only
 * way to navigate while the map is moving.
 */
const FAST_FRAME_FULL_DETAIL = false;
const FAST_FRAME_GRATICULE = false;
/** false = only `style.highlight()` features (selected + neighbours) keep their stroke. */
const FAST_FRAME_FULL_STROKES = false;

export function render(
  rc: RenderContext,
  world: World,
  style: Style,
  focus: Set<Feature>,
  uiFont: string,
  pulse?: Pulse
): void {
  const { ctx, camera, viewport, fast } = rc;

  resetTransform(rc);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = COLORS.ocean;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  if (!fast || FAST_FRAME_GRATICULE) drawGraticule(rc);

  const copyCandidates = camera.zoom < viewport.width * 1.6 ? [-1, 0, 1] : [0];
  // copy 0 always renders even if the visibility maths somehow says otherwise — it must
  // never be possible to cull the map down to a blank canvas
  const copies = copyCandidates.filter(copy => copy === 0 || isCopyVisible(rc, copy));

  const full = (!fast || FAST_FRAME_FULL_DETAIL) && useFullDetail(camera, viewport);
  // world.fullContext/fullLakes start empty and fill in once attachFullDetail runs — fall
  // back to the coarse (always-populated) versions until then, same as activePath does
  // per feature.
  const contextShapes = full && world.fullContext.length ? world.fullContext : world.context;
  const lakeShapes = full && world.fullLakes.length ? world.fullLakes : world.lakes;

  for (const copy of copies) {
    applyTransform(rc, copy);
    ctx.lineJoin = 'round';

    ctx.fillStyle = COLORS.context;
    for (const shape of contextShapes) ctx.fill(shape.path);

    // Computed once per copy and reused for both passes below — same bbox test the pin
    // logic already needs (onScreenWidth), just against the viewport instead of a pixel
    // threshold. A frame is pixel-identical to drawing every feature unconditionally:
    // nothing visible is skipped, only work for shapes nowhere near the viewport.
    const visible = world.features.filter(
      feature => activePath(feature, full) && !drawsAsPin(feature, camera) && isFeatureVisible(rc, feature, copy)
    );

    for (const feature of visible) {
      const colour = style.fill(feature);
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fill(activePath(feature, full)!);
    }

    // strokes in a second pass so no fill can bleed over a neighbour's border
    for (const feature of visible) {
      if (fast && !FAST_FRAME_FULL_STROKES && !style.highlight?.(feature)) continue;
      const s = style.stroke(feature);
      if (!s) continue;
      ctx.strokeStyle = s[0];
      ctx.lineWidth = s[1] / camera.zoom;
      ctx.stroke(activePath(feature, full)!);
    }

    // lakes on top of the land they cut into, so the Caspian reads as water sitting in
    // Kazakhstan/Russia rather than a hole through to the page background
    ctx.fillStyle = COLORS.ocean;
    for (const lake of lakeShapes) ctx.fill(lake.path);

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
  drawCapitals(rc, world, style);
  if (style.showLabels) drawLabels(rc, world, uiFont, style);
  if (pulse) drawPulse(rc, pulse);
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
  const full = useFullDetail(camera, viewport);

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
      const path = activePath(feature, full);
      if (!path || drawsAsPin(feature, camera)) continue;
      if (ctx.isPointInPath(path, px, py)) {
        resetTransform(rc);
        return feature;
      }
    }
  }
  resetTransform(rc);
  return null;
}

/**
 * The capital ring under this screen point, if the layer is showing. Tested before
 * countries by the caller — the ring sits on top of whatever it overlaps, like a pin.
 * Same predicate as the drawing (capitalsVisible), so a ring you can't see can't be hit,
 * and nothing is hittable under quizMode.
 */
export function pickPlace(
  rc: RenderContext,
  world: World,
  style: Pick<Style, 'showCapitals' | 'quizMode'>,
  sx: number,
  sy: number,
  radius = CAPITAL_PICK_RADIUS
): PlaceMark | null {
  const { camera, viewport } = rc;
  if (!capitalsVisible(style, camera, viewport)) return null;
  let nearest: PlaceMark | null = null;
  let nearestDistance = radius;
  for (const mark of world.places) {
    if (!capitalShapeShowing(mark, camera, viewport)) continue;
    const [x, y] = worldToScreen(camera, viewport, mark.ux, mark.uy);
    const distance = Math.hypot(x - sx, y - sy);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = mark;
    }
  }
  return nearest;
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
