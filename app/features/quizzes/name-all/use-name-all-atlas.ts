/**
 * The map side of a "Name all countries" run: quiz mode for the route's lifetime, answered
 * countries coloured, the scope as the camera's home, the phone's immersive layout and the
 * insets the HUD and input bar leave.
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react';

import { SCOPE_VIEWS, type QuizScope } from '~/features/countries';
import { useAtlasContext } from '~/features/map';
import { NO_INSETS } from '~/engines/map/follow';
import { measureInsets } from '~/features/quizzes/engine/insets';
import type { CountryRecord } from '~/engines/map/types';
import { useQuizPageLock } from '~/shared/lib/keyboard';
import { isCoarsePointer, isPhoneLayout } from '~/shared/layout/viewport';
import type { Phase } from './name-all-types';

export function useNameAllAtlas({ scope, phase, paused, named, pool, ready, keyboardStrip, inputRef }: {
  scope: QuizScope;
  phase: Phase;
  paused: boolean;
  named: readonly string[];
  pool: readonly CountryRecord[];
  ready: boolean;
  /** `${kb}:${top}:${height}` of useKeyboard(): the map's strip is measured again when it changes. */
  keyboardStrip: string;
  inputRef: RefObject<HTMLInputElement | null>;
}): void {
  const { atlas, setQuiz, setImmersive, setSheetSnap } = useAtlasContext();
  const running = phase === 'running';
  const finished = phase === 'done' || phase === 'gaveup';

  /* Quiz mode for the whole lifetime of the route (names, search and tooltips hidden). Depends on
     nothing but the stable setter, so a late-initialising atlas never wipes the answered map. */
  const atlasRef = useRef(atlas);
  atlasRef.current = atlas;
  useEffect(() => {
    setQuiz({ target: null, answered: new Map(), showNeighbours: false, showCapital: false, paused: false });
    return () => {
      setQuiz(null);
      atlasRef.current?.setFocus([]);
    };
  }, [setQuiz]);

  /* Correct countries green; after a give-up the missed ones red. */
  const answered = useMemo(() => {
    const map = new Map<string, 'correct' | 'revealed'>(named.map(iso3 => [iso3, 'correct']));
    if (phase === 'gaveup') for (const c of pool) if (!map.has(c.iso3)) map.set(c.iso3, 'revealed');
    return map;
  }, [named, phase, pool]);
  useEffect(() => {
    setQuiz(prev => (prev ? { ...prev, answered, paused } : prev));
  }, [answered, paused, setQuiz]);

  /* The scope is the camera's home: START, a name and the results all frame it. */
  useEffect(() => {
    if (!atlas) return;
    const view = SCOPE_VIEWS[scope] ?? null;
    atlas.setRegionView(view);
    if (view) atlas.home();
    return () => {
      atlas.setRegionView(null);
      if (view) atlas.home();
    };
  }, [atlas, scope]);
  useEffect(() => {
    if (finished) atlas?.home();
  }, [finished, atlas]);

  /* Phone: the run owns the whole screen from START until its results, which open the sheet at full. */
  const ownsScreen = ready && !finished;
  useEffect(() => {
    setImmersive(ownsScreen);
    return () => setImmersive(false);
  }, [ownsScreen, setImmersive]);
  useQuizPageLock(ownsScreen);
  useEffect(() => {
    if (finished) setSheetSnap('full');
  }, [finished, setSheetSnap]);
  useEffect(() => {
    if (finished) inputRef.current?.blur();
  }, [finished]);

  /* The map's visible strip is what the HUD and the input bar leave, measured again whenever the
     keyboard opens or closes. The canvas never takes focus from the input during a run. */
  useEffect(() => {
    if (!atlas || !isPhoneLayout()) return;
    atlas.setInsets(running ? measureInsets() : NO_INSETS);
    return () => atlas.setInsets(NO_INSETS);
  }, [atlas, running, keyboardStrip]);
  useEffect(() => {
    if (!atlas) return;
    atlas.setKeepFocus(running && (isPhoneLayout() || isCoarsePointer()));
    return () => atlas.setKeepFocus(false);
  }, [atlas, running]);
}
