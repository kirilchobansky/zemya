/**
 * The atlas bridge of a geography quiz run: everything the run needs from the atlas layout —
 * quiz-mode painting mirrored from the engine, the camera (home on START and on finish,
 * follow + pulse on each new target, the phone's insets), the phone's immersive layout and
 * the sheet, and the focus rules. Only the visual per-question experience is left to the
 * quiz's own Stage component. See CLAUDE.md's Quizzes section.
 */
import { useEffect, useRef } from "react";

import { useAtlasContext } from '~/features/map';
import { SCOPE_VIEWS, type QuizScope, type QuizSize } from '~/features/countries';
import { useKeyboard, useQuizPageLock } from "~/shared/lib/keyboard";
import { NO_INSETS } from "~/engines/map/follow";
import { isCoarsePointer, isPhoneLayout } from "~/shared/layout/viewport";
import type { World } from "~/engines/map/types";
import type { QuizEngine } from '../engine/engine';
import { measureInsets } from '../engine/insets';
import type { QuizDefinition } from '../engine/types';

export function useQuizAtlasBridge({ engine, definition, scope, requestedSize, size, world }: {
  engine: QuizEngine;
  definition: QuizDefinition | undefined;
  scope: QuizScope | null;
  requestedSize: QuizSize | null;
  size: QuizSize | null;
  world: World | null;
}): void {
  const { atlas, setQuiz, setImmersive, setSheetSnap } = useAtlasContext();
  const keyboard = useKeyboard();

  /* quiz mode covers the whole lifetime of this route, not just the running phase — the
     map should already be in its stripped-down, full-screen state on the START (idle)
     screen. Torn down on unmount so leaving the run restores the normal map.
     Deliberately depends on nothing but the (stable) setQuiz setter: if this also
     depended on `atlas`, it would re-fire — and wipe the in-progress answered map — the
     moment the Atlas controller finished initialising after this route had already
     mounted and the user had started answering. */
  const atlasRef = useRef(atlas);
  atlasRef.current = atlas;
  const markCapital = Boolean(definition?.markCapital);
  useEffect(() => {
    setQuiz({
      target: null,
      answered: new Map(),
      showNeighbours: false,
      showCapital: markCapital,
      paused: false,
    });
    return () => {
      setQuiz(null);
      atlasRef.current?.setFocus([]); // don't leave a random country's pin permanently enlarged
    };
  }, [setQuiz, markCapital]);

  /* little to no zoom, on purpose — the run stays at (roughly) the world view the whole
     time, so a target is found by its highlight (or, for a quiz whose Stage doesn't use
     the map at all, isn't found on the map at all) rather than the camera flying to it;
     see CLAUDE.md's Quizzes section. Watches phase transitions rather than running once
     per render. */
  /* A continent quiz's "home" is that continent, not the world: START, a guess, the results
     screen and ⌂ all return to it. Declared before the START effect below so the very first
     home() already frames the continent. Cleared on unmount so the atlas is a world map
     again. */
  useEffect(() => {
    if (!atlas) return;
    const view = (scope && SCOPE_VIEWS[scope]) || null;
    atlas.setRegionView(view);
    if (view) atlas.home(); // show the continent behind the START dock, not the whole world
    return () => {
      atlas.setRegionView(null);
      if (view) atlas.home();
    };
  }, [atlas, scope]);

  /* Phone layout: a run owns the whole screen — no sheet, no tab bar — from the START screen
     until its results, which open the sheet at full height. Only for a valid run: the
     "not found" and "preparing" states keep the tab bar, so nobody is stranded. No effect on
     desktop, where the shell has no such state. */
  const validRun = Boolean(
    definition && scope && requestedSize && world && size,
  );
  const runOwnsScreen = validRun && engine.phase !== "done";
  useEffect(() => {
    setImmersive(runOwnsScreen);
    return () => setImmersive(false);
  }, [runOwnsScreen, setImmersive]);
  useQuizPageLock(runOwnsScreen);
  const finished = validRun && engine.phase === "done";
  // Up leaves a run or its results like Abandon, to the list with this quiz open (UpButton)
  useEffect(() => {
    if (finished) setSheetSnap("full");
  }, [finished, setSheetSnap]);

  /* The camera's visible area during a phone run is the strip between the HUD and the input bar,
     and the input bar rides on the keyboard — so it is measured again whenever the keyboard opens
     or closes, and the current target is followed again inside the new strip (it may now be
     behind the keyboard). Declared before the START and target effects below, so on the first
     question the camera already knows the strip. Desktop: measured once per phase, as before. */
  const running = engine.phase === "running" || engine.phase === "paused";
  const targetRef = useRef(engine.target);
  targetRef.current = engine.target;
  // the strip changes when the keyboard covers the layout viewport (iOS) or shrinks it (Android)
  const strip = `${keyboard.kb}:${keyboard.top}:${keyboard.height}`;
  const lastFollowedStripRef = useRef(strip);
  useEffect(() => {
    if (!atlas || !isPhoneLayout()) return;
    atlas.setInsets(running ? measureInsets() : NO_INSETS);
    return () => atlas.setInsets(NO_INSETS);
  }, [atlas, running, strip]);
  useEffect(() => {
    if (lastFollowedStripRef.current === strip) return;
    lastFollowedStripRef.current = strip;
    const target = targetRef.current;
    if (
      !world ||
      !atlas ||
      !running ||
      !target ||
      definition?.hidesMap ||
      !isPhoneLayout()
    )
      return;
    const feature = world.byIso3.get(target.iso3);
    if (!feature) return;
    const place = definition?.markCapital
      ? (world.places.find((mark) => mark.feature === feature) ?? null)
      : null;
    // two frames on: where the keyboard resized the layout viewport, the atlas hears about its
    // new canvas size from a ResizeObserver that has not fired yet
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        atlas.followTarget({ feature, place }, measureInsets()); // no pulse: it is the same question
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [strip, world, atlas, running, definition]);

  /* The canvas must not take focus during a run: dragging or pinching the map must never blur
     the input or close the keyboard. Only where there IS a keyboard to protect — a phone layout
     or a touch pointer. On desktop a canvas click still blurs the input, and the typing capture
     in engine.ts (which tests/e2e/smoke.mjs exercises) is what gets the next keystroke back into it. */
  useEffect(() => {
    if (!atlas) return;
    atlas.setKeepFocus(running && (isPhoneLayout() || isCoarsePointer()));
    return () => atlas.setKeepFocus(false);
  }, [atlas, running]);

  /* The results sheet covers the screen: the keyboard has done its job. */
  useEffect(() => {
    if (finished) engine.inputRef.current?.blur();
  }, [finished, engine.inputRef]);

  const prevPhaseRef = useRef(engine.phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    // START only — idle/done -> running. Resuming from pause is ALSO "not running -> running",
    // and used to reset the player's zoom to the world view.
    if ((prev === "idle" || prev === "done") && engine.phase === "running")
      atlas?.home();
    if (prev !== "done" && engine.phase === "done") {
      atlas?.home();
      atlas?.setFocus([]);
    }
    prevPhaseRef.current = engine.phase;
  }, [engine.phase, atlas]);

  /* Each NEW question — however we got to it: correct, skipped, revealed-then-answered — goes
     through Atlas#followTarget, the one place the quiz camera decides (return home if zoomed in,
     then centre / fit / zoom in until legible; see follow.ts), then pulses the target once so it
     can be found. Ordered after the START effect above, so on the first question the camera is
     already home. Keyed on the target changing, not on renders: a wrong attempt leaves the
     target alone, so it neither moves the camera nor pulses, and resuming from pause doesn't. */
  const lastPulsedRef = useRef<string | null>(null);
  useEffect(() => {
    if (engine.phase === "idle" || engine.phase === "done") {
      lastPulsedRef.current = null;
    }
    if (!world || !atlas || engine.phase !== "running" || definition?.hidesMap)
      return;
    const iso3 = engine.target?.iso3 ?? null;
    if (!iso3 || iso3 === lastPulsedRef.current) return;
    lastPulsedRef.current = iso3;
    const feature = world.byIso3.get(iso3);
    if (!feature) return;
    const place = definition?.markCapital
      ? (world.places.find((mark) => mark.feature === feature) ?? null)
      : null;
    atlas.followTarget({ feature, place }, measureInsets()); // the one camera decision, however we got here
    atlas.pulse(place?.ux ?? feature.ux, place?.uy ?? feature.uy);
  }, [engine.target, engine.phase, world, atlas, definition]);

  /* the target's pin/shape is marked "in focus" (renderer.ts draws a bigger, ringed pin
     for it under quizMode) purely from a Feature lookup — invisible, and harmless, for a
     Stage that never shows the map. */
  useEffect(() => {
    if (!world) return;
    const feature = engine.target
      ? (world.byIso3.get(engine.target.iso3) ?? null)
      : null;
    atlas?.setFocus(feature ? [feature] : []);
    setQuiz((prev) => (prev ? { ...prev, target: feature } : prev));
  }, [engine.target, world, atlas, setQuiz]);

  useEffect(() => {
    setQuiz((prev) =>
      prev
        ? {
            ...prev,
            answered: engine.answered,
            showNeighbours: engine.showNeighbours,
            paused: engine.phase === "paused",
          }
        : prev,
    );
  }, [engine.answered, engine.showNeighbours, engine.phase, setQuiz]);
}
