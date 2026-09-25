import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration
} from 'react-router';

import './styles/app.css';

export function links() {
  return [
    { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
    { rel: 'icon', href: '/favicon-48.png', type: 'image/png', sizes: '48x48' },
    { rel: 'icon', href: '/favicon-96.png', type: 'image/png', sizes: '96x96' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
    { rel: 'manifest', href: '/manifest.webmanifest' },
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
    {
      rel: 'stylesheet',
      href:
        'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700' +
        '&family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700' +
        '&family=IBM+Plex+Mono:wght@400;500;600&display=swap'
    }
  ];
}

/**
 * Applies a stored theme choice before the stylesheet paints anything, so the page never
 * flashes dark then light (or vice versa) — see app/lib/theme.ts's own note on why this is
 * the one place localStorage is read synchronously. 'zemya:theme' and the light/dark check
 * must match that module's STORAGE_KEY and getTheme() exactly.
 */
const THEME_INIT_SCRIPT = `(function(){try{
  var t = localStorage.getItem('zemya:theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}})();`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* first child, before any stylesheet: must run before first paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#080D13" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#F4F1EA" media="(prefers-color-scheme: light)" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="empty" style={{ paddingTop: '18vh' }}>
      <div className="empty__icon">{is404 ? '🧭' : '⚠'}</div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, margin: '0 0 8px' }}>
        {is404 ? 'No such place' : 'Something went wrong'}
      </h1>
      <p>
        {is404
          ? 'That country is not in the atlas.'
          : 'The atlas failed to load. Reloading usually fixes it.'}
      </p>
      <p style={{ marginTop: 18 }}>
        <a className="action action--primary" href="/">
          Back to the map
        </a>
      </p>
    </main>
  );
}
