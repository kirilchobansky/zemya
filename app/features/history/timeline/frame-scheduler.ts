/**
 * Render requests for HistoryTimeline (timeline.ts): at most one render per animation
 * frame, however many events ask (same rule as Atlas), plus an immediate render for a
 * resize that must not flash.
 */
export class FrameScheduler {
  private queued = 0;

  constructor(private renderNow: () => void) {}

  /** Ask for a render: at most one per animation frame, however many events ask. */
  request = (): void => {
    if (!this.queued) this.queued = requestAnimationFrame(this.flush);
  };

  private flush = (): void => {
    this.queued = 0;
    this.renderNow();
  };

  /** Render this frame now (a resize that must not flash). */
  now(): void {
    cancelAnimationFrame(this.queued);
    this.flush();
  }

  cancel(): void {
    cancelAnimationFrame(this.queued);
  }
}
