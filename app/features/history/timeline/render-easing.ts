/**
 * Easing, fades and the per-entry hover/active animation state of the history renderer.
 */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

export function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/** 1 through the middle of [0, sizePx], ramping linearly down to 0 as `px` crosses into
 *  the outer `margin`-wide band at either end — the fade half of the edge-margin
 *  treatment (see RENDER_CONFIG.edgeMarginPx and drawEventPins). Evaluated against the
 *  entry's own TRUE (unclamped) position, so an entry approaching the edge fades out even
 *  though clampToMargin below is holding its drawn position still. */
export function edgeFade(px: number, sizePx: number, margin: number): number {
  if (px <= 0 || px >= sizePx) return 0;
  if (px < margin) return px / margin;
  if (px > sizePx - margin) return (sizePx - px) / margin;
  return 1;
}

/** The clamp half of the edge-margin treatment: never draw past the margin band, whatever
 *  the entry's true position — see edgeFade above for the accompanying opacity. */
export function clampToMargin(px: number, sizePx: number, margin: number): number {
  return clamp(px, margin, sizePx - margin);
}

/** How long one full brighten/dim cycle of the arrival pulse takes (ms) — purely visual,
 *  independent of PULSE_DURATION_MS (timeline.ts), which decides when the pulse stops
 *  entirely. */
const PULSE_CYCLE_MS = 260;

/** Time constant (ms) for a capsule/pin's own idle↔active blend — "animate active/idle
 *  changes with about 120ms easing" (`rate = 1 - exp(-dt / MS)`). */
const ACTIVE_EASE_MS = 120;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Cross-frame easing state for every id's idle(0)↔active(1) blend (drawWireCapsules'
 *  fill/border/glow, drawEventPins' line/dot), keyed by entry id. Module-level, not part
 *  of RenderContext, because render() is otherwise a stateless per-frame function with no
 *  instance of its own to hold it on — safe because only one history timeline ever renders
 *  at a time (single canvas route). Holds only entries currently mid-transition; one that
 *  reaches its resting value (0, idle) is dropped rather than tracked forever. */
export const activeAmounts = new Map<string, number>();

let activeAmountsLastTime = 0;

/**
 * Eases every id's own amount toward 1 (a member of `activeIds` — every entry whose span
 * currently contains the viewport centre, ALL of them at once, not a single "the" focus —
 * see render()) or back down to 0 (everything else, including whatever was active a moment
 * ago), over ACTIVE_EASE_MS. Returns the live map read back by drawWireCapsules/
 * drawEventPins; an id absent from it is simply 0 (never active, or its own ease-out
 * already finished).
 */
export function updateActiveAmounts(activeIds: ReadonlySet<string>): ReadonlyMap<string, number> {
  const now = nowMs();
  const dt = activeAmountsLastTime ? Math.min(now - activeAmountsLastTime, 100) : 100;
  activeAmountsLastTime = now;
  const rate = 1 - Math.exp(-dt / ACTIVE_EASE_MS);

  for (const id of activeIds) {
    if (!activeAmounts.has(id)) activeAmounts.set(id, 0);
  }
  for (const [id, amt] of activeAmounts) {
    const target = activeIds.has(id) ? 1 : 0;
    const next = amt + (target - amt) * rate;
    if (!activeIds.has(id) && next < 0.002) {
      activeAmounts.delete(id);
    } else {
      activeAmounts.set(id, next);
    }
  }
  return activeAmounts;
}

/** The pulse's own opacity at `elapsedMs` since it started: oscillates between 0.35 and 1
 *  on a sine wave — never fully invisible, so the outline stays a smooth "pulse" rather
 *  than a blink. */
export function pulseAlpha(elapsedMs: number): number {
  return 0.675 + 0.325 * Math.sin((elapsedMs / PULSE_CYCLE_MS) * Math.PI * 2);
}
