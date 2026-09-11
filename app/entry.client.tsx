import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';

/**
 * The client entry — the framework-mode equivalent of a Vite template's `main.tsx`.
 * It hydrates the prerendered document rather than rendering into an empty `#root`,
 * so `hydrateRoot` is handed `document` itself: the `<html>` tree came from
 * `root.tsx`'s `Layout` at build time and is already on screen before this runs.
 */
startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>
  );
});
