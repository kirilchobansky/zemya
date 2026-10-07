/**
 * State of the quiz list page: which quiz is expanded, the chosen scope and order per quiz,
 * the personal bests (loaded after mount — IndexedDB does not exist during prerender) and the
 * run-history panel.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';

import { bestQuizTime, deleteQuizRun, listQuizRuns, type QuizRunEntry } from '~/features/progress';
import { sizesForPool, type QuizScope, type QuizSize } from '~/features/countries';
import { formatDuration } from '~/shared/lib/format';
import type { QuizSelectionMode } from '../geography/quizzes';
import { bestKey, type PoolCounts } from './quiz-list-data';

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

  /** {quizId}:{scope}:{size} -> fastest recorded time, or null. Starts empty and fills in
   *  after mount — IndexedDB doesn't exist during prerender, so the first render (and its
   *  hydration match) simply shows no best times yet, same as a genuinely new browser. */
  const [bestTimes, setBestTimes] = useState<Record<string, number | null>>({});
  const [history, setHistory] = useState<{
    quizId: string;
    scope: QuizScope;
    size: QuizSize;
  } | null>(null);
  const [runs, setRuns] = useState<QuizRunEntry[]>([]);
  const refreshBestTimes = useCallback(
    async (quizId: string, scope: QuizScope) => {
      const entries = await Promise.all(
        sizesForPool(scopeCounts[quizId][scope]).map(
          async (size) =>
            [
              bestKey(quizId, scope, size),
              await bestQuizTime(quizId, scope, size),
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
    refreshBestTimes(openId, scopes[openId] ?? "world");
  }, [refreshBestTimes, scopes, openId, hasSubject]);

  async function openHistory(quizId: string, scope: QuizScope, size: QuizSize) {
    setHistory({ quizId, scope, size });
    setRuns(await listQuizRuns(quizId, scope, size));
  }

  async function handleDelete(run: QuizRunEntry) {
    if (run.id === undefined || !history) return;
    if (!window.confirm(`Delete this run (${formatDuration(run.timeMs)})?`))
      return;
    await deleteQuizRun(run.id);
    const { quizId, scope, size } = history;
    const [freshRuns, freshBest] = await Promise.all([
      listQuizRuns(quizId, scope, size),
      bestQuizTime(quizId, scope, size),
    ]);
    setRuns(freshRuns);
    setBestTimes((prev) => ({
      ...prev,
      [bestKey(quizId, scope, size)]: freshBest,
    }));
  }

  return {
    openId, setOpenId, scopeOf, setScopes, selectionModeOf, setSelectionModes,
    bestTimes, history, setHistory, runs, openHistory, handleDelete
  };
}
