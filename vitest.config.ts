import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Deliberately its own config rather than reusing vite.config.ts's `reactRouter()` plugin:
 * these are unit tests for plain TypeScript logic (the scheduler, the mastery derivation),
 * not the app. They need the same `~` alias so app/lib/core and app/lib/geography import
 * exactly as they do in the real app, and nothing else.
 */
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts']
  }
});
