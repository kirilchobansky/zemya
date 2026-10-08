/**
 * The map of a finished geography run: names shown, hovering names a country, a click opens that
 * country's dossier whether it was guessed or missed. The dossier's Back returns to the saved
 * results (use-results-return.ts). Active only on the results — during a run, a review pass
 * included, the map stays nameless and a click does nothing.
 */
import { useEffect, useRef } from 'react';

import { useAtlasContext } from '~/features/map';
import type { Feature } from '~/engines/map/types';
import { useGo } from '~/shared/lib/navigation';
import { useResultsReturn } from './use-results-return';

export function useResultsInspect(active: boolean, snapshot: () => unknown | null, fresh: unknown): void {
  const { setQuiz } = useAtlasContext();
  const go = useGo();
  const back = useResultsReturn(snapshot, fresh);
  const backRef = useRef(back);
  backRef.current = back;

  useEffect(() => {
    if (!active) return;
    const onInspect = (feature: Feature) => {
      backRef.current.onClick();
      go(`/country/${feature.country.slug}`, { state: backRef.current.state });
    };
    setQuiz(prev => (prev ? { ...prev, onInspect } : prev));
    return () => setQuiz(prev => {
      if (!prev) return prev;
      const { onInspect: _gone, ...rest } = prev;
      return rest;
    });
  }, [active, go, setQuiz]);
}
