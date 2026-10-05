/**
 * "Back" for the sidebar's top button: one step back in the app, and where that goes when there
 * is no step to take.
 *
 * - If the previous history entry is one this app pushed (React Router keeps `idx` in
 *   `history.state`; it is 0 for the first in-app entry of a tab, also after a refresh or a direct
 *   link), go back one entry — the real "previous place", with its own state.
 * - Otherwise go to the page's logical parent (`parentPath`): run -> its quiz list -> Quizzes -> map.
 * - On the home screen there is nowhere to go (`parentPath('/') === null`).
 *
 * Leaving an active quiz run this way is the same as abandoning it: the route unmounts, nothing
 * is saved (there is no confirmation to keep — the run's own Abandon has none either).
 */
import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';

/** The logical parent of a pathname, or null for the home screen. Pure, so it is unit-tested. */
export function parentPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const [first, second] = segments;
  if (first === 'quizzes' || first === 'quiz') {
    // a geography run (/quizzes/:subject/:quizId/:scope/:size) belongs to its subject's list
    if (first === 'quizzes' && second && second !== 'history' && segments.length > 2) return `/quizzes/${second}`;
    if (first === 'quizzes' && segments.length > 1) return `/${segments.slice(0, -1).join('/')}`;
    return first === 'quizzes' ? '/' : '/quizzes';
  }
  if (first === 'history' && segments.length > 1) return `/${segments.slice(0, -1).join('/')}`;
  return '/'; // /country/:slug, /questions, /history, ...
}

/** True when the entry behind the current one was pushed by this app. */
function hasInAppPrevious(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
}

export function useBack(): { canGoBack: boolean; goBack: () => void } {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const canGoBack = parentPath(pathname) !== null;

  const goBack = useCallback(() => {
    const parent = parentPath(window.location.pathname);
    if (parent === null) return;
    if (hasInAppPrevious()) navigate(-1);
    else navigate(parent);
  }, [navigate]);

  /* Alt+Left, except while typing: in a text field it must keep its own meaning (Option+Left jumps a
     word on a Mac), and a quiz input must never lose a keystroke to navigation. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
      if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
      if (parentPath(window.location.pathname) === null) return;
      e.preventDefault();
      goBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goBack]);

  return { canGoBack, goBack };
}
