/**
 * Sidebar sizing constants and persistence for the atlas shell (desktop layout only): the
 * rail's and the panel's min/max/default widths, and their {width, collapsed} state in
 * localStorage, one JSON blob per side.
 */
export const RAIL_MIN_PX = 180;
export const RAIL_MAX_PX = 320;
export const PANEL_MIN_PX = 300;
export const PANEL_MAX_PX = 560;
/** Below this viewport width, a sidebar with no stored width yet opens narrower — applied
 *  post-mount only (the useLayoutEffect below), never during the first render, since
 *  window.innerWidth isn't available (or wouldn't match) during the server's prerender. */
export const NARROW_VIEWPORT_PX = 1440;
export const RAIL_DEFAULT_WIDE_PX = 286;
export const RAIL_DEFAULT_NARROW_PX = 238;
export const PANEL_DEFAULT_WIDE_PX = 372;
export const PANEL_DEFAULT_NARROW_PX = 330;

export function clampPx(px: number, min: number, max: number): number {
  return Math.min(Math.max(px, min), max);
}

export function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < NARROW_VIEWPORT_PX;
}

export function defaultRailWidth(): number {
  return isNarrowViewport() ? RAIL_DEFAULT_NARROW_PX : RAIL_DEFAULT_WIDE_PX;
}

export function defaultPanelWidth(): number {
  return isNarrowViewport() ? PANEL_DEFAULT_NARROW_PX : PANEL_DEFAULT_WIDE_PX;
}

export interface SidebarPersisted {
  width: number;
  collapsed: boolean;
}

/** Reads one sidebar's persisted {width, collapsed} — wrapped in try/catch (localStorage
 *  can throw in a private window or with site data blocked) and sanity-checked against the
 *  given bounds, so a value from an older build with different min/max can't wedge the
 *  layout. */
export function loadSidebar(key: string, fallbackWidth: number, min: number, max: number): SidebarPersisted {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { width: fallbackWidth, collapsed: false };
    const parsed = JSON.parse(raw) as Partial<SidebarPersisted>;
    const width = typeof parsed.width === 'number' && Number.isFinite(parsed.width) ? clampPx(parsed.width, min, max) : fallbackWidth;
    return { width, collapsed: parsed.collapsed === true };
  } catch {
    return { width: fallbackWidth, collapsed: false };
  }
}

export function saveSidebar(key: string, value: SidebarPersisted): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage unavailable (private window, blocked site data, ...) — the sidebar just
    // reopens at its default next time, same as CLAUDE.md asks for every localStorage use.
  }
}

export const RAIL_STORAGE_KEY = 'zemya.sidebar.rail';
export const PANEL_STORAGE_KEY = 'zemya.sidebar.panel';

/** Which sidebar a drag/keyboard/double-click action targets — the two share this module's
 *  handling almost entirely, only their min/max/default/storage differ. */
export type SidebarSide = 'rail' | 'panel';
