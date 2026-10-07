/**
 * The desktop sidebars of the atlas shell: the rail's and the panel's width and collapsed
 * state (hydrated from localStorage after mount, persisted on change), the drag-to-resize
 * handle, reset, and the "[" / "]" shortcuts. Phone layout has no sidebars.
 */
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { useLocation } from 'react-router';

import { isPhoneLayout } from '~/shared/layout/viewport';
import {
  PANEL_DEFAULT_WIDE_PX, PANEL_MAX_PX, PANEL_MIN_PX, PANEL_STORAGE_KEY, RAIL_DEFAULT_WIDE_PX, RAIL_MAX_PX, RAIL_MIN_PX,
  RAIL_STORAGE_KEY, clampPx, defaultPanelWidth, defaultRailWidth, loadSidebar, saveSidebar, type SidebarSide
} from '../sidebar-storage';

export function useSidebars() {
  const location = useLocation();

  /* ---------------------------------------------------------------- sidebar resize/collapse
     Desktop only (see the module-level comment above). The very first render — server AND
     client — must produce the same `.shell` markup, so it always starts from the same fixed
     constants; reading localStorage or window.innerWidth here (both browser-only, both
     absent or different during the server's prerender) would make the client's first render
     disagree with the prerendered HTML it's hydrating onto, a hydration mismatch on `.shell`
     itself. The real, possibly-narrower, possibly-stored width/collapsed state is applied
     right after mount instead, in the useLayoutEffect below — synchronously before the
     browser paints, so there's no visible flash of the default width first. */
  const [railWidth, setRailWidth] = useState(RAIL_DEFAULT_WIDE_PX);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDE_PX);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  /** Which sidebar's handle is actively being dragged, if any — only used to suppress
   *  .shell's own width transition (layout.css's .shell.is-resizing) so the drag tracks the
   *  pointer with no lag; the actual width updates happen straight from the pointer
   *  handlers in startSidebarDrag below, not through this. */
  const [resizingSide, setResizingSide] = useState<SidebarSide | null>(null);
  /** False until the post-mount hydration effect below has run once — guards the
   *  persist-to-localStorage effects so they can't fire for the fixed first-render
   *  defaults and overwrite a returning visitor's real saved width with them. State, not a
   *  ref: each persist effect must see the value that was current AT ITS OWN RENDER (a ref
   *  would already read `true` by the time ANY passive effect runs, since the layout effect
   *  below sets it before every passive effect this commit — state keeps the two renders'
   *  effect instances honestly telling apart "before" from "after" hydration). */
  const [sidebarHydrated, setSidebarHydrated] = useState(false);

  useLayoutEffect(() => {
    const rail = loadSidebar(RAIL_STORAGE_KEY, defaultRailWidth(), RAIL_MIN_PX, RAIL_MAX_PX);
    setRailWidth(rail.width);
    setRailCollapsed(rail.collapsed);
    const panel = loadSidebar(PANEL_STORAGE_KEY, defaultPanelWidth(), PANEL_MIN_PX, PANEL_MAX_PX);
    setPanelWidth(panel.width);
    setPanelCollapsed(panel.collapsed);
    setSidebarHydrated(true);
  }, []);

  useEffect(() => {
    if (!sidebarHydrated) return;
    saveSidebar(RAIL_STORAGE_KEY, { width: railWidth, collapsed: railCollapsed });
  }, [sidebarHydrated, railWidth, railCollapsed]);
  useEffect(() => {
    if (!sidebarHydrated) return;
    saveSidebar(PANEL_STORAGE_KEY, { width: panelWidth, collapsed: panelCollapsed });
  }, [sidebarHydrated, panelWidth, panelCollapsed]);

  /** Starts a drag on either sidebar's handle: tracks the pointer with plain window
   *  listeners (simpler than pointer capture here — the pointer never needs to leave the
   *  window, and the handle itself is about to be a fixed 0-width strip once collapsed, an
   *  awkward capture target) and writes the clamped width straight to state every move. */
  const startSidebarDrag = useCallback((side: SidebarSide, e: ReactPointerEvent) => {
    e.preventDefault();
    const handleEl = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startWidth = side === 'rail' ? railWidth : panelWidth;
    const [min, max] = side === 'rail' ? [RAIL_MIN_PX, RAIL_MAX_PX] : [PANEL_MIN_PX, PANEL_MAX_PX];
    const setWidth = side === 'rail' ? setRailWidth : setPanelWidth;
    const setCollapsed = side === 'rail' ? setRailCollapsed : setPanelCollapsed;
    setCollapsed(false); // dragging a collapsed sidebar's handle (from its edge tab state) reopens it
    setResizingSide(side);
    handleEl.classList.add('is-dragging');
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      // The rail grows to the right (delta positive = wider); the panel grows to the left
      // (delta positive, i.e. dragging right, = narrower) — each handle sits on its
      // sidebar's INNER edge, facing the map.
      const raw = side === 'rail' ? startWidth + delta : startWidth - delta;
      setWidth(clampPx(raw, min, max));
    };
    const onUp = () => {
      setResizingSide(null);
      handleEl.classList.remove('is-dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [railWidth, panelWidth]);

  const resetSidebarWidth = useCallback((side: SidebarSide) => {
    (side === 'rail' ? setRailWidth : setPanelWidth)(side === 'rail' ? defaultRailWidth() : defaultPanelWidth());
  }, []);

  const toggleRailCollapsed = useCallback(() => setRailCollapsed(v => !v), []);
  // Navigating (a section tab, a country) reopens a collapsed panel — otherwise the click
  // appears to do nothing. Skips the first run so a stored collapsed choice survives a load.
  const lastPathRef = useRef(location.pathname);
  useEffect(() => {
    if (lastPathRef.current === location.pathname) return;
    lastPathRef.current = location.pathname;
    setPanelCollapsed(false);
  }, [location.pathname]);
  const togglePanelCollapsed = useCallback(() => setPanelCollapsed(v => !v), []);
  // "[" toggles the rail, "]" toggles the panel — ignored while typing in an input (Ctrl+[ and
  // Ctrl+] still work there: they type nothing), and desktop-only (phone has no rail and the panel is the bottom sheet, not this sidebar).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== '[' && e.key !== ']') return;
      if (isPhoneLayout()) return;
      const target = e.target;
      if (!e.ctrlKey && target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      if (e.key === '[') setRailCollapsed(v => !v);
      else setPanelCollapsed(v => !v);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return {
    railWidth, railCollapsed, panelWidth, panelCollapsed, resizingSide,
    startSidebarDrag, resetSidebarWidth, toggleRailCollapsed, togglePanelCollapsed
  };
}
