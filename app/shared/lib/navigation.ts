/**
 * History-stack policy. Going to a new place pushes an entry; changing the state of the place
 * you are already at (or leaving a finished run) replaces it, so Back never walks through
 * duplicates. `<Link>` already replaces when it points at the current URL; `navigate()` does
 * not, hence these.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router';

/** `to` is the page the browser is already showing (path, search and hash all equal). */
export function isCurrentUrl(to: string, current: string): boolean {
  const base = 'http://x';
  const a = new URL(to, base + current);
  const b = new URL(current, base);
  return a.pathname === b.pathname && a.search === b.search && a.hash === b.hash;
}

export interface GoOptions {
  state?: unknown;
  /** Replace the current entry. Default: only when `to` is the current URL. */
  replace?: boolean;
}

/** `navigate` that never pushes a duplicate of the current entry. */
export function useGo() {
  const navigate = useNavigate();
  return useCallback((to: string, { state, replace }: GoOptions = {}) => {
    const here = window.location.pathname + window.location.search + window.location.hash;
    navigate(to, { state, replace: replace ?? isCurrentUrl(to, here) });
  }, [navigate]);
}
