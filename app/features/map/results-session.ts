/**
 * The finished quiz a dossier can return to, kept in memory (no storage). Set when the user leaves
 * a quiz's results for a country; the dossier shows "← Back to quiz results" and the missed
 * countries under it for as long as it lives, across any number of dossiers, map clicks and
 * searches. Cleared by `useClearResultsSession` (AtlasShell) as soon as the location is neither
 * a dossier nor the run itself — the Map tab, another section, or the quiz's own Back.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';

export interface MissedLink { slug: string; name: string; emoji: string }
export interface ResultsSession {
  /** The run's URL (path + search) and the token of the results saved for it. */
  to: string;
  token: string;
  missed: MissedLink[];
}

let session: ResultsSession | null = null;
const listeners = new Set<() => void>();

export function setResultsSession(next: ResultsSession | null): void {
  session = next;
  listeners.forEach(l => l());
}

export function useResultsSession(): ResultsSession | null {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => session,
    () => null
  );
}

/** Drops the session once the user is anywhere but a dossier or the run it came from. */
export function useClearResultsSession(): void {
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (session && !pathname.startsWith('/country/') && pathname + search !== session.to) setResultsSession(null);
  }, [pathname, search]);
}
