/**
 * State of the quiz list page: which quiz is expanded, the chosen scope and order per quiz,
 * the personal bests (loaded after mount — IndexedDB does not exist during prerender) and the
 * run-history panel.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';

import { bestQuizTime, deleteQuizRun, listQuizRuns, type QuizRunEntry } from '~/features/progress';
import { sizesForPool, type QuizScope } from '~/features/countries';
import { formatDuration } from '~/shared/lib/format';
import { NAME_ALL_ID, type QuizSelectionMode } from '../geography/quizzes';
import { bestKey, type PoolCounts } from './quiz-list-data';

/** Name all has no Random / Population choice, so its archive is not split. */
const archiveModeOf = (quizId: string, mode: QuizSelectionMode) => (quizId === NAME_ALL_ID ? undefined : mode);

export function useQuizList(scopeCounts: PoolCounts, hasSubject: boolean) {
  /** Which quiz's options are expanded — one at a time, collapsed by default. */
  // Back from a quiz's start screen hands the quiz (and scope) it came from over in location state.
  const left = useLocation().state as { openQuiz?: string; openScope?: QuizScope } | null;
  const [openId, setOpenId] = useState<string | null>(
    hasSubject && left?.openQuiz && scopeCounts[left.openQuiz] ? left.openQuiz : null,
  );
  /** Chosen scope per quiz; every quiz keeps its own chip row across collapses. */
  const [scopes, setScopes] = useState<Record<string, QuizScope>>(
    left?.openQuiz && left.openScope && scopeCounts[left.openQuiz]?.[left.openScope] ? { [left.openQuiz]: left.openScope } : {},
  );
  const scopeOf = (quizId: string): QuizScope => scopes[quizId] ?? "world";
  const [selectionModes, setSelectionModes] = useState<
    Record<string, QuizSelectionMode>
  >({});
  const selectionModeOf = (quizId: string): QuizSelectionMode =>
    selectionModes[quizId] ?? "random";

  /** {quizId}:{scope}:{size}:{mode} -> fastest archived time of that category, or null. Starts
   *  empty and fills in after mount — IndexedDB doesn't exist during prerender, so the first
   *  render (and its hydration match) shows none, like a genuinely new browser. */
  const [bestTimes, setBestTimes] = useState<Record<string, number | null>>({});
  const [history, setHistory] = useState<{
    quizId: string;
    scope: QuizScope;
    mode: QuizSelectionMode;
  } | null>(null);
  const [runs, setRuns] = useState<QuizRunEntry[]>([]);
  /** Each size card's best is the fastest run of that same size (a top-10 run never competes
   *  with the All run) in the chosen mode. */
  const refreshBests = useCallback(
    async (quizId: string, scope: QuizScope, mode: QuizSelectionMode) => {
      const entries = await Promise.all(
        sizesForPool(scopeCounts[quizId][scope]).map(
          async (size) =>
            [
              bestKey(quizId, scope, size, mode),
              await bestQuizTime(quizId, scope, size, archiveModeOf(quizId, mode)),
            ] as const,
        ),
      );
      setBestTimes((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    },
    [scopeCounts],
  );

  // An opened quiz brings its options into view (on a phone the list is longer than the sheet).
  // Also when the sheet has only just opened: it scrolls once the panel reaches full.
  useEffect(() => {
    if (!openId) return;
    const scroll = () =>
      document
        .querySelector<HTMLElement>(`[data-quiz-id="${openId}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const panel = document.querySelector<HTMLElement>('.panel');
    scroll();
    if (!panel) return;
    let wasFull = panel.dataset.snap === 'full';
    const observer = new MutationObserver(() => {
      const full = panel.dataset.snap === 'full';
      if (full && !wasFull) scroll();
      wasFull = full;
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['data-snap'] });
    return () => observer.disconnect();
  }, [openId]);

  useEffect(() => {
    if (!openId || !hasSubject) return;
    refreshBests(openId, scopes[openId] ?? "world", selectionModes[openId] ?? "random");
  }, [refreshBests, scopes, selectionModes, openId, hasSubject]);

  /** The archive holds every run of the quiz, scope and mode, whatever the size. */
  async function openHistory(quizId: string, scope: QuizScope, mode: QuizSelectionMode) {
    setHistory({ quizId, scope, mode });
    setRuns(await listQuizRuns(quizId, scope, undefined, archiveModeOf(quizId, mode)));
  }

  async function handleDelete(run: QuizRunEntry) {
    if (run.id === undefined || !history) return;
    if (!window.confirm(`Delete this run (${formatDuration(run.timeMs)})?`))
      return;
    const { quizId, scope, mode } = history;
    await deleteQuizRun(run.id);
    setRuns(await listQuizRuns(quizId, scope, undefined, archiveModeOf(quizId, mode)));
    refreshBests(quizId, scope, mode);
  }

  return {
    openId, setOpenId, scopeOf, setScopes, selectionModeOf, setSelectionModes,
    bestTimes, history, setHistory, runs, openHistory, handleDelete
  };
}
