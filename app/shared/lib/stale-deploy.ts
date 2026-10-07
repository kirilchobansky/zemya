/**
 * A page that outlives a deploy asks for chunk files that no longer exist. One automatic reload
 * fetches the new build; the sessionStorage stamp makes it at most one per minute, so a chunk
 * that is genuinely missing cannot reload in a loop. With storage unavailable there is no
 * guard, so nothing reloads.
 */
const KEY = 'zemya:stale-reload';
const WINDOW_MS = 60_000;

/** Reloads the page unless it already did within the last minute. Returns whether it did. */
export function reloadOnce(reload: () => void = () => window.location.reload()): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(KEY));
    if (last && Date.now() - last < WINDOW_MS) return false;
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  reload();
  return true;
}

/** Vite fires `vite:preloadError` when a dynamic import's chunk or CSS fails to load. */
export function installStaleDeployGuard(): () => void {
  const onError = (event: Event) => {
    console.error('[stale-deploy] a chunk failed to load (vite:preloadError); reloading once');
    if (reloadOnce()) event.preventDefault();
  };
  window.addEventListener('vite:preloadError', onError);
  return () => window.removeEventListener('vite:preloadError', onError);
}
