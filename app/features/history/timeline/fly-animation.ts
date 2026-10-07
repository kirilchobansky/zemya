/**
 * The fly-to animation of HistoryTimeline (timeline.ts): center is interpolated linearly
 * and pxPerYear on a log scale, both eased in-out, re-clamped every frame.
 */
import { clampCenter, clampPxPerYear, type TimeRange, type Viewport } from './scale';
import { FLY_DURATION_MS } from './timeline-config';

export interface FlyAnim {
  startTime: number;
  fromCenter: number;
  toCenter: number;
  fromLogPxPerYear: number;
  toLogPxPerYear: number;
  pulseEntryId: string | null;
}

export function startFly(
  viewport: Viewport,
  toCenter: number,
  toPxPerYear: number,
  pulseEntryId: string | null,
  now: number
): FlyAnim {
  return {
    startTime: now,
    fromCenter: viewport.center,
    toCenter,
    fromLogPxPerYear: Math.log(viewport.pxPerYear),
    toLogPxPerYear: Math.log(toPxPerYear),
    pulseEntryId
  };
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Advances `anim` by one frame — interpolates center linearly and pxPerYear on a log
 *  scale, re-clamping center every frame against the CURRENT (mid-flight) pxPerYear so the
 *  clamp never lags a frame behind the zoom. `done` once the flight lands (t >= 1). */
export function stepFly(
  anim: FlyAnim,
  viewport: Viewport,
  contentRange: TimeRange,
  pannableRange: TimeRange,
  now: number
): { viewport: Viewport; done: boolean } {
  const t = Math.min((now - anim.startTime) / FLY_DURATION_MS, 1);
  const eased = easeInOutCubic(t);
  const pxPerYear = clampPxPerYear(
    Math.exp(anim.fromLogPxPerYear + (anim.toLogPxPerYear - anim.fromLogPxPerYear) * eased),
    viewport.sizePx, contentRange
  );
  const rawCenter = anim.fromCenter + (anim.toCenter - anim.fromCenter) * eased;
  const center = clampCenter(rawCenter, pxPerYear, viewport.sizePx, pannableRange);
  return { viewport: { ...viewport, center, pxPerYear }, done: t >= 1 };
}
