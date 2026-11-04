/**
 * Registers the offline service worker (built by scripts/build/build-sw.mjs) once the page has
 * loaded, so it never competes with first paint. Production only: the dev server has no sw.js.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
