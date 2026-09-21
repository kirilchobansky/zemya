/**
 * The two axes the mobile work switches on — kept apart on purpose (CLAUDE.md "Mobile"):
 *
 *   LAYOUT follows viewport WIDTH. Below PHONE_MAX_WIDTH the shell is a full-screen map with a
 *   bottom sheet and a tab bar; above it, the desktop grid — an iPad in landscape stays desktop.
 *   INPUT AFFORDANCES follow the POINTER. `(pointer: coarse)` is what decides touch-sized
 *   targets, hidden hover/shortcut hints and the DPR cap, whatever the width.
 *
 * Nearly all of it is CSS, so the prerendered markup is identical for every visitor and there
 * is nothing to mismatch on hydration. These helpers are for the few behaviours that live in
 * JS (sheet dragging, camera insets); every one reads the browser at event/effect time only.
 * PHONE_MAX_WIDTH / LANDSCAPE_PHONE_MAX_HEIGHT mirror the media queries in app.css — change both.
 */
import { useSyncExternalStore } from 'react';

export const PHONE_MAX_WIDTH = 819;
/** Landscape phones are short: a coarse pointer under LANDSCAPE_PHONE_MAX_HEIGHT gets the phone
 *  layout too, however wide. Mirrors the media query in app.css. */
export const LANDSCAPE_PHONE_MAX_HEIGHT = 499;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px), (pointer: coarse) and (max-height: ${LANDSCAPE_PHONE_MAX_HEIGHT}px)`;
/** Within the phone layout: wider than tall means the sheet is a right-hand drawer and the tab
 *  bar a slim vertical bar on the left. */
export const LANDSCAPE_QUERY = '(orientation: landscape)';
export const COARSE_QUERY = '(pointer: coarse)';

const matches = (query: string): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

export const isPhoneLayout = (): boolean => matches(PHONE_QUERY);
export const isCoarsePointer = (): boolean => matches(COARSE_QUERY);

/** Live media query for JS-side decisions. Server and first client render say `false`, so
 *  hydration matches; the real answer arrives with the next render. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    notify => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** Phone layout AND landscape: the drawer arrangement. */
export const isPhoneLandscape = (): boolean => isPhoneLayout() && matches(LANDSCAPE_QUERY);
