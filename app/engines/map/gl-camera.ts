/**
 * The GL map's camera: moves (animated or not), framing a country or a set, the quiz
 * follow decision, and the move events. The app's camera maths (camera.ts, follow.ts) is
 * unchanged; MapLibre only draws and moves.
 */
import {
  centreInVisible, clamp, clampZoom, frame, homeCamera, homeZoom, scaleBar, shortestX,
  type CameraState, type Insets
} from './camera';
import { cameraForTarget, markerPoint, NO_SHAPE_ZOOM_FACTOR, quizFollowTarget, QUIZ_WORLD_VIEW_FACTOR } from './follow';
import type { GlHost } from './gl-host';
import { pxToZoom, zoomToPx } from './gl-style';
import { latToY, lonToX, xToLon, yToLat } from './projection';
import type { Feature, PlaceMark } from './types';

/** How long a camera animation (fly-to, home, quiz follow) takes. */
const EASE_MS = 750;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export interface CameraHooks {
  /** A drag starts: the pointer is carrying the map, not pointing at a country. */
  userMoveStart(): void;
  /** The camera moved: re-sync everything that depends on it. */
  afterMove(): void;
}

export class GlCamera {
  private target: CameraState;
  /** True from the moment our own easeTo starts until it ends (or a gesture interrupts it). */
  private ownEase = false;
  private regionView: [number, number, number, number] | null = null;
  private lastScale = { km: 0, px: 0 };

  constructor(private host: GlHost, home: CameraState, private hooks: CameraHooks) {
    this.target = home;
  }

  /** True while one of our own animations runs. */
  get easing(): boolean {
    return this.ownEase;
  }

  setRegionView(box: [number, number, number, number] | null): void {
    this.regionView = box;
  }

  home(animate = true): void {
    this.moveTo(this.homeView(), animate);
  }

  zoomBy(factor: number): void {
    const heading = this.heading;
    this.moveTo(clamp({ ...heading, zoom: heading.zoom * factor }, this.host.viewport), true);
  }

  flyTo(feature: Feature, padding = 0.55): void {
    if (!feature.bbox) {
      const point = markerPoint(feature, null);
      if (!point) return;
      const zoom = homeZoom(this.host.viewport) * NO_SHAPE_ZOOM_FACTOR;
      this.moveTo(clamp({ ...centreInVisible(point.x, point.y, zoom, this.host.insets), zoom }, this.host.viewport), true);
      return;
    }
    const [minLon, minLat, maxLon, maxLat] = feature.bbox;
    this.moveTo(
      frame({ x0: lonToX(minLon), x1: lonToX(maxLon), y0: latToY(maxLat), y1: latToY(minLat) }, this.host.viewport, padding, Infinity, this.host.insets),
      true
    );
  }

  /** The quiz camera's one decision — see Atlas#followTarget (atlas.ts), which this mirrors
   *  line for line: follow.ts decides, and only a result that differs from where the camera
   *  is HEADING moves it. */
  followTarget(request: { feature: Feature; place?: PlaceMark | null }, insets: Insets): void {
    const { feature, place } = request;
    const cam = this.heading;
    const home = this.homeView();
    const zoomedIn = cam.zoom > home.zoom * QUIZ_WORLD_VIEW_FACTOR;

    const target = quizFollowTarget(feature, place ?? null, this.host.viewport);
    if (!target) return;
    const options = { noShapeZoom: homeZoom(this.host.viewport) * NO_SHAPE_ZOOM_FACTOR };
    let base = cam;
    let next = cameraForTarget(base, this.host.viewport, insets, target, options);
    if (next && zoomedIn) {
      base = home;
      next = cameraForTarget(base, this.host.viewport, insets, target, options);
    }

    const dest = clamp(next ?? base, this.host.viewport);
    const now = clamp(cam, this.host.viewport);
    const moved =
      Math.abs(dest.zoom - now.zoom) > now.zoom * 1e-6 ||
      Math.abs(dest.x - now.x) > 1e-9 ||
      Math.abs(dest.y - now.y) > 1e-9;
    if (moved) this.moveTo(dest, true);
  }

  fit(features: Feature[], padding = 0.6): void {
    const boxed = features.filter(f => f.bbox);
    if (!boxed.length) return this.home();
    const xs: number[] = [];
    const ys: number[] = [];
    for (const f of boxed) {
      const [minLon, minLat, maxLon, maxLat] = f.bbox!;
      xs.push(lonToX(minLon), lonToX(maxLon));
      ys.push(latToY(maxLat), latToY(minLat));
    }
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    if (x1 - x0 > 0.75) return this.home();
    this.moveTo(frame({ x0, x1, y0: Math.min(...ys), y1: Math.max(...ys) }, this.host.viewport, padding, 12, this.host.insets), true);
  }

  get scale(): { km: number; px: number } {
    return scaleBar(this.camera, this.host.viewport);
  }

  /* -------------------------------------------------------------------- camera */

  /** The camera as drawn right now, in the app's unit-square terms. */
  get camera(): CameraState {
    const c = this.host.map.getCenter();
    return { x: lonToX(c.lng), y: latToY(c.lat), zoom: zoomToPx(this.host.map.getZoom()) };
  }

  /** Where the camera is HEADING: our own animation's destination while one runs, else where it is. */
  get heading(): CameraState {
    return this.ownEase ? this.target : this.camera;
  }

  homeView(): CameraState {
    if (!this.regionView) return homeCamera(this.host.viewport, this.host.insets);
    const [minLon, minLat, maxLon, maxLat] = this.regionView;
    return frame({ x0: lonToX(minLon), x1: lonToX(maxLon), y0: latToY(maxLat), y1: latToY(minLat) }, this.host.viewport, 0.85, Infinity, this.host.insets);
  }

  private moveTo(next: CameraState, animate: boolean): void {
    const target = clamp({ ...next, x: shortestX(this.camera.x, next.x) }, this.host.viewport);
    this.target = target;
    const center: [number, number] = [xToLon(target.x), yToLat(target.y)];
    const zoom = pxToZoom(target.zoom);
    if (!animate) {
      this.ownEase = false;
      this.host.map.jumpTo({ center, zoom });
      this.target = this.camera;
      return;
    }
    this.host.map.easeTo({ center, zoom, duration: EASE_MS, easing: easeOut, essential: true }, { zemya: true });
    this.ownEase = true; // after easeTo: starting it ends (and flags) whatever ran before
  }

  readonly onMoveStart = (e: object): void => {
    if (!(e as { zemya?: boolean }).zemya) {
      this.hooks.userMoveStart();
      this.ownEase = false;
      this.target = this.camera;
    }
  };

  readonly onMove = (): void => {
    this.hooks.afterMove();
    const scale = this.scale;
    if (scale.km !== this.lastScale.km || Math.round(scale.px) !== Math.round(this.lastScale.px)) {
      this.lastScale = scale;
      this.host.callbacks.onCameraChange?.(scale);
    }
  };

  readonly onMoveEnd = (e: object): void => {
    if ((e as { zemya?: boolean }).zemya) this.ownEase = false;
    if (!this.ownEase) this.target = this.camera;
  };
}
