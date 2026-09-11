/**
 * The only bridge between the store and React. Components read the in-memory snapshot and
 * call `review`; nothing outside this file imports Dexie.
 *
 * Hydration: the first client render must match the prerendered HTML exactly, so the
 * snapshot starts empty and `ready` starts false on both sides. Cards arrive in an effect,
 * after hydration, and the UI re-renders into its real state. Anything that renders
 * progress must therefore have a sensible "not loaded yet" appearance — which is the same
 * as "nothing learned yet", so this costs nothing.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';

import {
  exportAll,
  importAll,
  loadCards,
  logReview,
  parseExport,
  resetAll,
  saveCard
} from './progress';
import { grade, newCard, type ProgressCard, type ReviewRating } from './scheduler';

export type CardMap = ReadonlyMap<string, ProgressCard>;

interface ProgressValue {
  cards: CardMap;
  /** False until the first read from IndexedDB has resolved. */
  ready: boolean;
  /** Grade one card, creating it if this is its first review. Returns immediately. */
  review(id: string, rating: ReviewRating): ProgressCard;
  exportJson(): Promise<string>;
  importJson(text: string): Promise<number>;
  reset(): Promise<void>;
}

const EMPTY: CardMap = new Map();

const ProgressContext = createContext<ProgressValue | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [cards, setCards] = useState<CardMap>(EMPTY);
  const [ready, setReady] = useState(false);

  /* the latest map, reachable from callbacks without making them change identity */
  const cardsRef = useRef<CardMap>(cards);
  cardsRef.current = cards;

  useEffect(() => {
    let cancelled = false;
    loadCards().then(rows => {
      if (cancelled) return;
      setCards(new Map(rows.map(row => [row.id, row])));
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  /**
   * Synchronous by design. State updates and the component tree re-renders in this tick;
   * the two writes below are fired afterwards and never awaited. A review that fails to
   * persist is a lost review — a review that blocks the UI is a broken app.
   */
  const review = useCallback((id: string, rating: ReviewRating): ProgressCard => {
    const existing = cardsRef.current.get(id);
    const next = grade(existing ?? newCard(id), rating);

    const updated = new Map(cardsRef.current);
    updated.set(id, next);
    cardsRef.current = updated;
    setCards(updated);

    saveCard(next);
    logReview({ cardId: id, rating, at: Date.now() });
    return next;
  }, []);

  const exportJson = useCallback(async () => {
    return JSON.stringify(await exportAll(), null, 2);
  }, []);

  const importJson = useCallback(async (text: string) => {
    const payload = parseExport(text); // throws ImportError before anything is touched
    const rows = await importAll(payload);
    const next = new Map(rows.map(row => [row.id, row]));
    cardsRef.current = next;
    setCards(next);
    return rows.length;
  }, []);

  const reset = useCallback(async () => {
    await resetAll();
    cardsRef.current = EMPTY;
    setCards(EMPTY);
  }, []);

  const value = useMemo<ProgressValue>(
    () => ({ cards, ready, review, exportJson, importJson, reset }),
    [cards, ready, review, exportJson, importJson, reset]
  );

  /**
   * Test seam. There are no quiz screens yet, so the smoke test has no way to grade a card
   * through the UI. `import.meta.env.DEV` is a compile-time constant, so this whole block —
   * and the reference to `review` it holds — is dead code eliminated from a production
   * build. Delete it once a real review screen exists.
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __zemya?: unknown }).__zemya = { review, reset, cards };
  }, [review, reset, cards]);

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

/**
 * Usable outside a provider — it degrades to "nothing learned, nothing writable" rather
 * than throwing, so a panel route can be rendered in isolation (and prerendered) without
 * every consumer guarding.
 */
export function useProgress(): ProgressValue {
  const value = useContext(ProgressContext);
  return value ?? FALLBACK;
}

const FALLBACK: ProgressValue = {
  cards: EMPTY,
  ready: false,
  review: () => { throw new Error('useProgress().review called outside a ProgressProvider'); },
  exportJson: async () => JSON.stringify({ app: 'zemya', cards: [], reviews: [] }),
  importJson: async () => 0,
  reset: async () => {}
};
