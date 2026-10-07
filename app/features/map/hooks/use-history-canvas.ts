/**
 * The history side of the atlas shell: the timeline's entries and labels (handed over by a
 * history route through AtlasContext), the HistoryTimeline controller and its canvas, hover,
 * pinned cards, the open detail entry and the filters. Everything resets on leaving the route.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { HistoryTimeline, type EntryKind, type HistoryHover, type TimelineEntry } from '~/features/history';
import type { TimelineLabels } from '../atlas-context';

export function useHistoryCanvas() {
  const historyCanvasRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HistoryTimeline | null>(null);
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[] | null>(null);
  const [timelineLabels, setTimelineLabels] = useState<TimelineLabels>({ pastLabel: '', futureLabel: '' });
  const [historyHover, setHistoryHover] = useState<HistoryHover | null>(null);
  /** Non-null only while a history route (routes/history/history.$slug.tsx) has handed its
   *  entries over — the canvas shows the map the rest of the time, including on the bare
   *  /history picker. */
  const showTimeline = timelineEntries !== null;

  /** Pinned timeline cards (click-to-pin — see HistoryTimeline's onEntryClick below), in
   *  pin order: appended on a new pin, never reordered by bring-to-front (`z` alone drives
   *  stacking), so array order is what "close the oldest" (max 8) reads off. */
  const [pinnedCards, setPinnedCards] = useState<
    { id: string; entry: TimelineEntry; rect: HistoryHover['rect']; z: number }[]
  >([]);
  const [selectedHistoryEntryId, setSelectedHistoryEntryId] = useState<string | null>(null);
  const [historyTimelineInstance, setHistoryTimelineInstance] = useState<HistoryTimeline | null>(null);
  const [historyCurrentPeriodId, setHistoryCurrentPeriodId] = useState<string | null>(null);
  const [historyHiddenKinds, setHistoryHiddenKinds] = useState<ReadonlySet<EntryKind>>(() => new Set());
  const [historyHiddenCategories, setHistoryHiddenCategories] = useState<ReadonlySet<string>>(() => new Set());
  /** Every pinned card's own current DOM rect, mutated straight from HistoryCard.tsx's
   *  onRectChange (mount + every drag frame) and forwarded to HistoryTimeline directly —
   *  a ref, not React state, so a drag doesn't re-render this whole shell every frame. */
  const pinnedRectsRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());
  const pinZRef = useRef(0);
  const MAX_PINNED_CARDS = 8;

  const handleEntryClick = useCallback((hit: HistoryHover) => {
    setPinnedCards(prev => {
      const z = ++pinZRef.current;
      const existing = prev.find(p => p.id === hit.entry.id);
      if (existing) return prev.map(p => (p.id === hit.entry.id ? { ...p, z } : p));
      const next = [...prev, { id: hit.entry.id, entry: hit.entry, rect: hit.rect, z }];
      return next.length > MAX_PINNED_CARDS ? next.slice(1) : next;
    });
  }, []);
  /** Pins an entry that isn't necessarily on screen (the detail view's "Pin card" button,
   *  app/features/history/components/HistoryDetail.tsx — it has no canvas rect of its own to seed the card's
   *  position from) — same mechanism as handleEntryClick, centred on the canvas instead of
   *  at a click point. */
  const pinHistoryEntry = useCallback((entry: TimelineEntry) => {
    const canvas = historyCanvasRef.current;
    const rect = { x: (canvas?.clientWidth ?? 0) / 2, y: (canvas?.clientHeight ?? 0) / 2, w: 0, h: 0 };
    handleEntryClick({ entry, rect });
  }, [handleEntryClick]);
  const handleCardFront = useCallback((id: string) => {
    setPinnedCards(prev => prev.map(p => (p.id === id ? { ...p, z: ++pinZRef.current } : p)));
  }, []);
  const handleCardRectChange = useCallback((id: string, rect: { x: number; y: number; w: number; h: number }) => {
    pinnedRectsRef.current.set(id, rect);
    timelineRef.current?.setPinnedCardRects(pinnedRectsRef.current);
  }, []);
  const handleCardClose = useCallback((id: string) => {
    setPinnedCards(prev => prev.filter(p => p.id !== id));
    setSelectedHistoryEntryId(sel => (sel === id ? null : sel));
    pinnedRectsRef.current.delete(id);
    timelineRef.current?.setPinnedCardRects(pinnedRectsRef.current);
  }, []);
  const closeAllHistoryCards = useCallback(() => {
    setPinnedCards([]);
    setSelectedHistoryEntryId(null);
    pinnedRectsRef.current.clear();
    timelineRef.current?.setPinnedCardRects(pinnedRectsRef.current);
  }, []);

  const toggleHistoryKind = useCallback((kind: EntryKind) => {
    setHistoryHiddenKinds(prev => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);
  const toggleHistoryCategory = useCallback((category: string) => {
    setHistoryHiddenCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);
  const resetHistoryFilters = useCallback(() => {
    setHistoryHiddenKinds(new Set());
    setHistoryHiddenCategories(new Set());
  }, []);

  // Leaving the history route (showTimeline going false) clears every pinned card, any open
  // detail view and every filter — "pinned cards are cleared when leaving the history
  // route" / "the [filter] state ... resets when leaving the history route."
  useEffect(() => {
    if (!showTimeline) {
      setPinnedCards([]);
      setSelectedHistoryEntryId(null);
      setHistoryHiddenKinds(new Set());
      setHistoryHiddenCategories(new Set());
      pinnedRectsRef.current.clear();
    }
  }, [showTimeline]);

  // Pushes HistoryFilters.tsx's own state down to the canvas controller whenever it
  // changes (including once the controller itself first mounts, via the timelineEntries dep).
  useEffect(() => {
    timelineRef.current?.setFilters(historyHiddenKinds, historyHiddenCategories);
  }, [historyHiddenKinds, historyHiddenCategories, timelineEntries]);

  // Esc closes the front-most pinned card (highest z) — global, since a card's own body
  // isn't necessarily focused.
  useEffect(() => {
    if (!showTimeline) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPinnedCards(prev => {
        if (!prev.length) return prev;
        const front = prev.reduce((a, b) => (b.z > a.z ? b : a));
        setSelectedHistoryEntryId(sel => (sel === front.id ? null : sel));
        return prev.filter(p => p.id !== front.id);
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showTimeline]);

  /**
   * The history timeline controller — constructed once entries arrive (a history route
   * pushed them via AtlasContext) and torn down once they're cleared (leaving that route).
   * Its own canvas sits underneath the map's, shown/hidden by `showTimeline` below; unlike
   * Atlas, it owns its own pan/zoom entirely (see CLAUDE.md's history exception) so nothing
   * else here drives it.
   */
  useEffect(() => {
    if (!timelineEntries || !historyCanvasRef.current || timelineRef.current) return;
    const timeline = new HistoryTimeline(historyCanvasRef.current, {
      axis: 'horizontal', entries: timelineEntries, pastLabel: timelineLabels.pastLabel, futureLabel: timelineLabels.futureLabel,
      onHover: setHistoryHover, onEntryClick: handleEntryClick,
      onPeriodChange: setHistoryCurrentPeriodId
    });
    timelineRef.current = timeline;
    setHistoryTimelineInstance(timeline);
    return () => {
      timeline.destroy();
      timelineRef.current = null;
      setHistoryTimelineInstance(null);
      setHistoryCurrentPeriodId(null);
      setHistoryHover(null);
    };
    // handleEntryClick is stable (useCallback, no deps) — the controller is built once per
    // entries array, same as before this effect took a second callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineEntries]);

  /** Keeps the canvas's persistent pinned-entry outline (renderer.ts) in sync with React's
   *  own pinned-card state, without rebuilding the controller. */
  useEffect(() => {
    timelineRef.current?.setPinnedIds(new Set(pinnedCards.map(p => p.id)));
  }, [pinnedCards]);

  const historyPinnedIds = useMemo(() => pinnedCards.map(p => p.id), [pinnedCards]);

  return {
    historyCanvasRef, timelineEntries, setTimelineEntries, timelineLabels, setTimelineLabels,
    historyHover, showTimeline, pinnedCards, selectedHistoryEntryId, setSelectedHistoryEntryId,
    historyTimelineInstance, historyCurrentPeriodId, historyHiddenKinds, historyHiddenCategories,
    toggleHistoryKind, toggleHistoryCategory, resetHistoryFilters, pinHistoryEntry,
    closeAllHistoryCards, handleCardClose, handleCardFront, handleCardRectChange, historyPinnedIds
  };
}
