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
import { useEffect, useSyncExternalStore } from 'react';

import { isPhoneLayout } from '~/shared/layout/viewport';

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
/** The latest reading, which the CSS variables follow. `state` (what React sees) trails it. */
let current: KeyboardState = CLOSED;
let layoutHeight = 0;
let kbEstimate = 0;
let orientation: MediaQueryList | null = null;
let frame = 0;
let settleTimer = 0;
const listeners = new Set<() => void>();
/** React hears about the keyboard only once it has stopped moving: the camera re-frames and the
 *  canvas redraws per notification, which must not happen on every frame of the animation. */
const SETTLE_MS = 120;

/** Rotating changes what "the keyboard-closed height" means, so forget what was learned. */
function onOrientation(): void {
  layoutHeight = 0;
  kbEstimate = 0;
  measure(true);
}

function setVar(name: string, value: string): void {
  const root = document.documentElement.style;
  if (root.getPropertyValue(name) !== value) root.setProperty(name, value);
}

function read(): void {
  frame = 0;
  const vv = window.visualViewport;
  if (!vv) return;
  layoutHeight = Math.max(layoutHeight, window.innerHeight);
  // a pinch-zoomed page has a smaller visual viewport too — that is not a keyboard
  const zoomed = Math.abs(vv.scale - 1) > 0.01;
  const covered = window.innerHeight - (vv.offsetTop + vv.height);
  const kb = !zoomed && covered >= MIN_KEYBOARD_PX ? Math.round(covered) : 0;
  const top = zoomed ? 0 : Math.max(0, Math.round(vv.offsetTop));
  kbEstimate = Math.max(kbEstimate, kb, Math.round(layoutHeight * KEYBOARD_FRACTION_ESTIMATE));

  // written only when the rounded value changed: a pan fires scroll events at touch rate
  setVar('--kb', `${kb}px`);
  setVar('--vv-top', `${top}px`);
  setVar('--layout-h', `${layoutHeight}px`);
  setVar('--kb-est', `${kbEstimate}px`);

  const height = Math.round(window.innerHeight);
  current = { kb, top, height };
}

function publish(): void {
  settleTimer = 0;
  if (current.kb === state.kb && current.top === state.top && current.height === state.height) return;
  state = current;
  listeners.forEach(l => l());
}

/** Reads once per animation frame, however many events asked; `now` reads and publishes at once. */
function measure(now = false): void {
  if (now) {
    if (frame) cancelAnimationFrame(frame);
    read();
    clearTimeout(settleTimer);
    publish();
    return;
  }
  if (!frame) frame = requestAnimationFrame(read);
  clearTimeout(settleTimer);
  settleTimer = window.setTimeout(publish, SETTLE_MS);
}

const onViewportChange = () => measure();

function subscribe(listener: () => void): () => void {
  const vv = window.visualViewport;
  if (listeners.size === 0) {
    measure(true);
    vv?.addEventListener('resize', onViewportChange);
    vv?.addEventListener('scroll', onViewportChange);
    window.addEventListener('resize', onViewportChange);
    orientation = window.matchMedia('(orientation: portrait)');
    orientation.addEventListener('change', onOrientation);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      vv?.removeEventListener('resize', onViewportChange);
      vv?.removeEventListener('scroll', onViewportChange);
      window.removeEventListener('resize', onViewportChange);
      cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(settleTimer);
      orientation?.removeEventListener('change', onOrientation);
      orientation = null;
      const root = document.documentElement.style;
      for (const name of ['--kb', '--vv-top', '--layout-h', '--kb-est']) root.removeProperty(name);
      state = CLOSED;
      current = CLOSED;
    }
  };
}

/** Live keyboard state. While mounted it also keeps the CSS variables above current. */
export function useKeyboard(): KeyboardState {
  return useSyncExternalStore(subscribe, () => state, () => CLOSED);
}

/** Where a touch may scroll while the page is locked: the run's own scrolling content. */
const SCROLLABLE = '.fill-quiz, .panel__body';
/** Inert even inside a scrollable area: the pause screens. */
const INERT = '.quiz-pause, .fill-quiz__pause';

/**
 * While `active` on a phone layout, a quiz run owns the screen: the page behind it cannot scroll,
 * rubber-band or be panned (html/body locked in CSS by `.is-quiz-locked`; iOS pans the visual
 * viewport on a drag that nothing scrolls, so such a touchmove is cancelled here). Only the run's
 * own content area (`SCROLLABLE`) scrolls. Removed on unmount.
 */
export function useQuizPageLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    html.classList.add('is-quiz-locked');
    const onTouchMove = (e: TouchEvent) => {
      if (!isPhoneLayout() || e.touches.length > 1 || !e.cancelable) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target && target.closest(SCROLLABLE) && !target.closest(INERT)) return;
      e.preventDefault();
    };
    // a focus() can still make the browser scroll the page to the input: put it back
    const onScroll = () => {
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    };
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      html.classList.remove('is-quiz-locked');
      document.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('scroll', onScroll);
    };
  }, [active]);
}
