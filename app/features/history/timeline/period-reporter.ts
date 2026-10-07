/**
 * "You are here": reports the period under the viewport's centre to a callback, throttled
 * to at most one call per PERIOD_CHANGE_THROTTLE_MS — "throttled to at most 5 updates per
 * second." Always keeps the LATEST id (never a stale one from earlier in the throttle
 * window): a pending call is stored in `pendingPeriodId` and overwritten in place; only the
 * timer that flushes it is throttled.
 */
import { PERIOD_CHANGE_THROTTLE_MS } from './timeline-config';

export class PeriodReporter {
  /** The id last actually delivered to onPeriodChange, and when — the throttle state.
   *  `pendingPeriodId` is `undefined` when nothing is queued, so a real `null` (no period
   *  at this moment) can still be pending. */
  private lastEmittedPeriodId: string | null = null;
  private lastPeriodEmitTime = 0;
  private pendingPeriodId: string | null | undefined = undefined;
  private periodChangeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private onPeriodChange: (periodId: string | null) => void) {}

  report(id: string | null): void {
    if (id === this.lastEmittedPeriodId && this.pendingPeriodId === undefined) return;
    this.pendingPeriodId = id;
    if (this.periodChangeTimer) return;
    const delay = Math.max(0, PERIOD_CHANGE_THROTTLE_MS - (performance.now() - this.lastPeriodEmitTime));
    this.periodChangeTimer = setTimeout(() => {
      this.periodChangeTimer = null;
      const toEmit = this.pendingPeriodId;
      this.pendingPeriodId = undefined;
      if (toEmit === undefined || toEmit === this.lastEmittedPeriodId) return;
      this.lastEmittedPeriodId = toEmit;
      this.lastPeriodEmitTime = performance.now();
      this.onPeriodChange(toEmit);
    }, delay);
  }

  destroy(): void {
    if (this.periodChangeTimer) clearTimeout(this.periodChangeTimer);
  }
}
