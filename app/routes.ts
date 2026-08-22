import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

/**
 * The atlas layout owns the map canvas. Both child routes render only the right-hand
 * panel, so navigating between countries never unmounts or re-initialises the renderer —
 * the URL is the selection, and the camera just flies.
 */
export default [
  layout('routes/atlas.tsx', [
    index('routes/atlas.index.tsx'),
    route('country/:slug', 'routes/country.tsx')
  ])
] satisfies RouteConfig;
