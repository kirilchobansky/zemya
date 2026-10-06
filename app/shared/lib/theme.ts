/**
 * Theme state: System / Light / Dark. "System" follows the OS (prefers-color-scheme) and
 * leaves [data-theme] off the document; an explicit choice sets it and wins over the OS.
 *
 * Persisted in localStorage — the one documented exception to CLAUDE.md's "no localStorage"
 * rule: it is a per-browser display preference, not progress data, and it must be read
 * synchronously (before React, before app.css's first paint) or the page flashes the wrong
 * theme. root.tsx's inline script duplicates STORAGE_KEY's value and this module's own
 * resolution logic for that reason — keep the two in sync if either changes.
 */
import { useSyncExternalStore } from 'react';

export type Theme = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'zemya:theme';

function isTheme(value: string | null): value is 'light' | 'dark' {
  return value === 'light' || value === 'dark';
}

/** The theme actually persisted, ignoring the OS — 'system' if nothing was ever chosen. */
export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system'; // a private window or blocked storage — fall back silently, same as ProgressProvider's own guard
  }
}

function applyToDocument(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
}

const listeners = new Set<() => void>();

/** Sets and persists the theme, applies it immediately, and tells every subscriber (the
 *  colour caches in renderer.ts/overlays.ts, and any component using useTheme()). */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // storage unavailable — the choice still applies for the rest of this session
  }
  applyToDocument(theme);
  for (const listener of listeners) listener();
}

/**
 * Subscribe to anything that could change the RESOLVED theme: an explicit setTheme() call,
 * or — only while 'system' is in effect — the OS preference itself changing. Returns an
 * unsubscribe function, same shape as viewport.ts's useMediaQuery.
 */
export function onThemeChange(listener: () => void): () => void {
  listeners.add(listener);
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const onMediaChange = () => {
    if (getTheme() === 'system') listener();
  };
  mq.addEventListener('change', onMediaChange);
  return () => {
    listeners.delete(listener);
    mq.removeEventListener('change', onMediaChange);
  };
}

/** Live theme for JS-side decisions (the theme switch's own pressed state). Components that
 *  only need to repaint when a *resolved colour* changes (Rail's legend, the tally, mastery
 *  pills) don't need the value itself — subscribing is enough to force their re-render, since
 *  renderer.ts/overlays.ts's colour caches are refreshed by the same event (see atlas.tsx). */
export function useTheme(): Theme {
  return useSyncExternalStore(onThemeChange, getTheme, () => 'system');
}
