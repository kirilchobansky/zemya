/**
 * Where the on-screen keyboard is, so the quiz input can sit directly above it.
 *
 * Browsers disagree, so this reads the one API that works everywhere — `visualViewport` — and
 * does not depend on the newer `interactive-widget=resizes-content` viewport hint (Chrome on
 * Android honours it and resizes the layout viewport itself; iOS Safari ignores it and only
 * shrinks the visual viewport, leaving fixed elements anchored to the full-height layout one).
 * Either way the answer is the same number: the distance from the visual viewport's bottom edge
 * to the layout viewport's bottom edge.
 *
 * It publishes CSS custom properties on <html> so the layout follows without React re-rendering
 * per animation frame:
 *   --kb        px the keyboard covers (0 when closed); the input bar's `bottom`
 *   --vv-top    px the visual viewport is scrolled down inside the layout viewport (iOS pans the
 *               page when it focuses an input); the HUD's `top`
 *   --layout-h  the tallest layout viewport seen: the "keyboard closed" height, stable while the
 *               keyboard is open even where the layout viewport itself shrinks
 *   --kb-est    the keyboard height to plan the fixed flag box around, before a real one has been
 *               measured and after: never decreases, so the box is sized once and never jumps
 *
 * and a hook so effects (the camera) can re-run when the keyboard opens or closes.
 */
import { useSyncExternalStore } from 'react';

export interface KeyboardState {
  /** px covered by the keyboard, 0 when closed. */
  kb: number;
  /** px the visual viewport sits below the layout viewport's top. */
  top: number;
  /** The layout viewport's height. Where the keyboard RESIZES the layout viewport (Android with
   *  interactive-widget=resizes-content) `kb` stays 0 and this is what changes. */
  height: number;
}

const CLOSED: KeyboardState = { kb: 0, top: 0, height: 0 };
/** Portrait phone keyboards cover ~38-42% of the screen; a suggestion bar adds a little. Planned
 *  generously so a flag sized to the estimate never ends up behind the real keyboard. */
const KEYBOARD_FRACTION_ESTIMATE = 0.5;
/** Under this a "keyboard" is just the URL bar collapsing or the home-indicator inset. */
const MIN_KEYBOARD_PX = 100;

let state: KeyboardState = CLOSED;
let layoutHeight = 0;
let kbEstimate = 0;
let orientation: MediaQueryList | null = null;
const listeners = new Set<() => void>();

/** Rotating changes what "the keyboard-closed height" means, so forget what was learned. */
function onOrientation(): void {
  layoutHeight = 0;
  kbEstimate = 0;
  measure();
}

function measure(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  layoutHeight = Math.max(layoutHeight, window.innerHeight);
  // a pinch-zoomed page has a smaller visual viewport too — that is not a keyboard
  const zoomed = Math.abs(vv.scale - 1) > 0.01;
  const covered = window.innerHeight - (vv.offsetTop + vv.height);
  const kb = !zoomed && covered >= MIN_KEYBOARD_PX ? Math.round(covered) : 0;
  const top = zoomed ? 0 : Math.max(0, Math.round(vv.offsetTop));
  kbEstimate = Math.max(kbEstimate, kb, Math.round(layoutHeight * KEYBOARD_FRACTION_ESTIMATE));

  const root = document.documentElement.style;
  root.setProperty('--kb', `${kb}px`);
  root.setProperty('--vv-top', `${top}px`);
  root.setProperty('--layout-h', `${layoutHeight}px`);
  root.setProperty('--kb-est', `${kbEstimate}px`);

  const height = Math.round(window.innerHeight);
  if (kb !== state.kb || top !== state.top || height !== state.height) {
    state = { kb, top, height };
    listeners.forEach(l => l());
  }
}

function subscribe(listener: () => void): () => void {
  const vv = window.visualViewport;
  if (listeners.size === 0) {
    measure();
    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    orientation = window.matchMedia('(orientation: portrait)');
    orientation.addEventListener('change', onOrientation);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      vv?.removeEventListener('resize', measure);
      vv?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      orientation?.removeEventListener('change', onOrientation);
      orientation = null;
      const root = document.documentElement.style;
      for (const name of ['--kb', '--vv-top', '--layout-h', '--kb-est']) root.removeProperty(name);
      state = CLOSED;
    }
  };
}

/** Live keyboard state. While mounted it also keeps the CSS variables above current. */
export function useKeyboard(): KeyboardState {
  return useSyncExternalStore(subscribe, () => state, () => CLOSED);
}
