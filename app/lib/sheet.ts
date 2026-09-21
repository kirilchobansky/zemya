/**
 * The phone bottom sheet: geometry and the drag gesture. No React state in here — during a drag
 * the sheet's transform is written straight to the element (one compositor-only property, no
 * re-render per touchmove); React only hears about the snap point it settles on.
 *
 * Snap heights are measured from the BOTTOM OF THE VIEWPORT. The sheet is 90dvh tall and sits
 * under the tab bar, so `peek` is the tab bar plus PEEK_PX of sheet, `half` is 50% of the
 * viewport and `full` is 90% — the same numbers the CSS uses (app.css, `.panel[data-snap]`).
 */
import { useEffect, type RefObject } from 'react';

export type SheetSnap = 'peek' | 'half' | 'full';

export const PEEK_PX = 88;
export const HALF_FRACTION = 0.5;
export const FULL_FRACTION = 0.9;
const SNAPS: readonly SheetSnap[] = ['peek', 'half', 'full'];

/** A drag must move this far before it is a drag rather than a tap or a scroll. */
const DRAG_SLOP_PX = 6;
/** How far ahead (ms) a flick's velocity is projected when picking the snap to settle on. */
const FLING_PROJECTION_MS = 160;

/** Visible height of the sheet at a snap point, from the viewport's bottom edge. */
export function sheetVisible(snap: SheetSnap, viewportHeight: number, tabBarHeight: number): number {
  if (snap === 'peek') return PEEK_PX + tabBarHeight;
  return viewportHeight * (snap === 'half' ? HALF_FRACTION : FULL_FRACTION);
}

/** The snap point one step up (or down, from full) — what tapping the handle does. */
export function stepSnap(snap: SheetSnap): SheetSnap {
  return snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half';
}

/** The snap whose visible height is closest to `visible`. */
export function nearestSnap(visible: number, viewportHeight: number, tabBarHeight: number): SheetSnap {
  let best: SheetSnap = 'peek';
  let bestDistance = Infinity;
  for (const snap of SNAPS) {
    const distance = Math.abs(sheetVisible(snap, viewportHeight, tabBarHeight) - visible);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = snap;
    }
  }
  return best;
}

interface SheetOptions {
  snap: SheetSnap;
  onSnap(snap: SheetSnap): void;
  /** No dragging at all when the sheet isn't the layout (desktop) or is hidden (a quiz run). */
  enabled: boolean;
}

/**
 * Wires the drag gestures onto the panel element:
 *   - the handle and the header drag the sheet;
 *   - inside the scrolling body, a drag moves the sheet only when the body is scrolled to the
 *     top (down always; up only when the sheet isn't yet full) — otherwise the body scrolls;
 *   - touch uses touch events (a non-passive touchmove is the only way to take a drag away from
 *     native scrolling); a mouse can drag the handle too, for a narrow desktop window.
 */
export function useSheetDrag(panel: RefObject<HTMLElement | null>, options: SheetOptions): void {
  const { snap, onSnap, enabled } = options;

  useEffect(() => {
    const el = panel.current;
    if (!el || !enabled) return;

    const viewportHeight = () => window.innerHeight;
    const tabBarHeight = () => document.querySelector<HTMLElement>('.tabbar')?.offsetHeight ?? 0;
    const sheetHeight = () => el.offsetHeight;

    let gesture: {
      startY: number;
      mode: 'pending' | 'sheet' | 'scroll';
      body: HTMLElement | null;
      startVisible: number;
      lastY: number;
      lastT: number;
      velocity: number; // px/ms, positive = moving up
    } | null = null;

    function begin(y: number, target: Element | null) {
      const visible = sheetVisible(snap, viewportHeight(), tabBarHeight());
      gesture = {
        startY: y,
        mode: 'pending',
        body: target?.closest<HTMLElement>('.panel__body') ?? null,
        startVisible: visible,
        lastY: y,
        lastT: performance.now(),
        velocity: 0
      };
    }

    function move(y: number): boolean {
      if (!gesture) return false;
      const dy = y - gesture.startY;
      if (gesture.mode === 'pending') {
        if (Math.abs(dy) < DRAG_SLOP_PX) return false;
        if (gesture.body) {
          // inside the content: the sheet only takes the gesture from a body already at the top
          const canMoveSheet = gesture.body.scrollTop <= 0 && (dy > 0 || snap !== 'full');
          gesture.mode = canMoveSheet ? 'sheet' : 'scroll';
        } else {
          gesture.mode = 'sheet';
        }
        if (gesture.mode === 'sheet') {
          el!.style.transition = 'none';
          // restart from here so the sheet doesn't jump by the slop it just crossed
          gesture.startY = y;
          gesture.startVisible = sheetVisible(snap, viewportHeight(), tabBarHeight());
        }
      }
      if (gesture.mode !== 'sheet') return false;

      const now = performance.now();
      const dt = now - gesture.lastT;
      if (dt > 0) gesture.velocity = gesture.velocity * 0.6 + (((gesture.lastY - y) / dt) * 0.4);
      gesture.lastY = y;
      gesture.lastT = now;

      const min = sheetVisible('peek', viewportHeight(), tabBarHeight());
      const max = sheetVisible('full', viewportHeight(), tabBarHeight());
      const visible = Math.max(min, Math.min(max, gesture.startVisible - (y - gesture.startY)));
      el!.style.transform = `translateY(${sheetHeight() - visible}px)`;
      return true;
    }

    function end() {
      const g = gesture;
      gesture = null;
      if (!g || g.mode !== 'sheet') return;
      const vh = viewportHeight();
      const tab = tabBarHeight();
      const current = sheetHeight() - (parseFloat(el!.style.transform.replace(/[^\d.-]/g, '')) || 0);
      const projected = current + g.velocity * FLING_PROJECTION_MS;
      const next = nearestSnap(projected, vh, tab);
      // set the attribute and drop the inline transform in the same tick, so the browser
      // animates from the dragged position to the snap instead of jumping
      el!.style.transition = '';
      el!.dataset.snap = next;
      el!.style.transform = '';
      onSnap(next);
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { gesture = null; return; }
      begin(e.touches[0].clientY, e.target as Element);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (move(e.touches[0].clientY) && e.cancelable) e.preventDefault();
    };
    const onTouchEnd = () => end();

    // mouse: the handle and header only (a wheel scrolls the body natively). Move/up listen on
    // the window for the length of the gesture rather than capturing the pointer — capture
    // would retarget the click that follows a plain tap on the handle button.
    let mouseDragged = false;
    const onMouseMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && move(e.clientY)) mouseDragged = true;
    };
    const onMouseUp = () => {
      window.removeEventListener('pointermove', onMouseMove);
      window.removeEventListener('pointerup', onMouseUp);
      end();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (!(e.target as Element).closest('.sheet__grip, .panel__head')) return;
      mouseDragged = false;
      begin(e.clientY, null);
      window.addEventListener('pointermove', onMouseMove);
      window.addEventListener('pointerup', onMouseUp);
    };
    // a drag that ends on the handle must not also count as a click on it
    const onClickCapture = (e: MouseEvent) => {
      if (mouseDragged) {
        e.stopPropagation();
        e.preventDefault();
        mouseDragged = false;
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('click', onClickCapture, true);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onMouseMove);
      window.removeEventListener('pointerup', onMouseUp);
      el.removeEventListener('click', onClickCapture, true);
      el.style.transition = '';
      el.style.transform = '';
    };
  }, [panel, snap, onSnap, enabled]);
}
