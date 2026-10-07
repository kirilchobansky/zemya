/**
 * Loads the world for a "Name all countries" run and derives the scope's country pool, the
 * prepared name index and the portal host. Portals need `document`, which prerender lacks, so
 * `mounted` flips after mount.
 */
import { useEffect, useMemo, useState } from 'react';

import { loadWorld, poolForQuiz, prepareCountryNames, type QuizScope } from '~/features/countries';
import { NAME_ALL_ID } from '~/features/quizzes/geography/quizzes';
import type { World } from '~/engines/map/types';

export function useNameAllWorld(scope: QuizScope) {
  const [world, setWorld] = useState<World | null>(null);
  const [stageHost, setStageHost] = useState<Element | null>(null);
  const [mounted, setMounted] = useState(false); // portals need `document`; prerender has none
  useEffect(() => {
    setStageHost(document.querySelector('main.stage'));
    setMounted(true);
    let cancelled = false;
    loadWorld().then(w => { if (!cancelled) setWorld(w); });
    return () => { cancelled = true; };
  }, []);

  const pool = useMemo(
    () => (world ? poolForQuiz(world.data.countries, NAME_ALL_ID, scope) : []),
    [world, scope]
  );
  const prepared = useMemo(() => prepareCountryNames(pool), [pool]);
  const byIso3 = useMemo(() => new Map(pool.map(c => [c.iso3, c])), [pool]);
  const total = pool.length;

  const ready = world !== null && total > 0;

  return { world, stageHost, mounted, pool, prepared, byIso3, total, ready };
}
