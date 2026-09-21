import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

import { siteUrl } from './scripts/lib/site.mjs';

export default defineConfig({
  define: { __SITE_URL__: JSON.stringify(siteUrl()) },
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url))
    }
  },
  plugins: [reactRouter()]
});
