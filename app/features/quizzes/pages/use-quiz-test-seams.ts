/**
 * Test seams of a geography quiz run, DEV only (dead code in a production build):
 * `window.__zemyaView` and `window.__zemyaQuiz`, read by tests/e2e/smoke.mjs.
 */
import { useEffect } from "react";

import { useAtlasContext } from '~/features/map';
import type { World } from "~/engines/map/types";
import type { QuizEngine } from '../engine/engine';
import type { QuizDefinition } from '../engine/types';

export function useQuizTestSeams({ engine, definition, world }: {
  engine: QuizEngine;
  definition: QuizDefinition | undefined;
  world: World | null;
}): void {
  const { atlas } = useAtlasContext();

  /** Live camera + target position for tests/e2e/smoke.mjs — a function, not a snapshot, so it
   *  reads the camera as it is when called (after the fly-to has settled). DEV only. */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __zemyaView?: unknown }).__zemyaView = () => {
      const feature =
        engine.target && world ? world.byIso3.get(engine.target.iso3) : null;
      const place =
        feature && definition?.markCapital
          ? world?.places.find((m) => m.feature === feature)
          : null;
      const view = atlas?.view;
      const canvas = document
        .querySelector(".stage__canvas")
        ?.getBoundingClientRect();
      const dock = document
        .querySelector(".quiz-dock")
        ?.getBoundingClientRect();
      return {
        camera: view ?? null,
        target:
          feature && atlas
            ? atlas.screenPosition(
                place?.ux ?? feature.ux,
                place?.uy ?? feature.uy,
              )
            : null,
        canvas: canvas
          ? {
              left: canvas.left,
              top: canvas.top,
              right: canvas.right,
              bottom: canvas.bottom,
            }
          : null,
        dockTop: dock ? dock.top : null,
      };
    };
  }, [atlas, world, engine.target, definition]);

  /**
   * Test seam, mirroring ProgressProvider's `window.__zemya` — a separate global so it
   * never clobbers that one. `import.meta.env.DEV` makes this dead code in a production
   * build. tests/e2e/smoke.mjs reads the current target's name from here rather than guessing
   * it from pixels, then asserts the NEXT target's name appears nowhere in the page — the
   * regression test for a quiz leaking an answer. `targetCapital` is the same for the
   * capitals quiz, whose answer is a city.
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __zemyaQuiz?: unknown }).__zemyaQuiz = {
      target: engine.target?.name ?? null,
      targetCapital: engine.target?.capital ?? null,
      answeredCount: engine.answeredCount,
      phase: engine.phase,
      elapsedMs: engine.elapsedMs,
    };
  }, [engine.target, engine.answeredCount, engine.phase, engine.elapsedMs]);
}
