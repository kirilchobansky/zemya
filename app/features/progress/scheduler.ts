/**
 * Spaced-repetition scheduling. The only module in the app that knows FSRS exists.
 *
 * Everything outside this file deals in `ProgressCard` — plain JSON, epoch milliseconds,
 * lower-case state strings — so the algorithm can be re-tuned or replaced without touching
 * the store, the UI, or the geography layer. No ts-fsrs type is re-exported on purpose.
 *
 * Card ids are opaque here. They are `subject:entity:facet` strings by convention
 * (`geo:BGR:capital`), but this module never parses one: the core must not learn what a
 * country is, or history cannot share the same store later.
 */
import { createEmptyCard, fsrs, Rating, State, type Card as FsrsCard } from 'ts-fsrs';

/** Our own state vocabulary, mirroring FSRS's four states without importing its enum. */
export type CardState = 'new' | 'learning' | 'review' | 'relearning';

/**
 * The four FSRS grades. A binary right/wrong quiz only ever produces `again` / `good`
 * (see `ratingForAnswer`); `hard` and `easy` exist so a four-button review screen can be
 * added later without changing this signature or migrating a single stored card.
 */
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ProgressCard {
  id: string;
  /** Epoch ms. Dates are not stored — IndexedDB keeps Date objects, but JSON export cannot. */
  due: number;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: CardState;
  lastReview: number | null;
}

/** One row of the append-only review log. */
export interface ReviewEntry {
  cardId: string;
  rating: ReviewRating;
  /** Epoch ms. */
  at: number;
}

const STATE_TO_FSRS: Record<CardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning
};

const STATE_FROM_FSRS: Record<State, CardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning'
};

const RATING_TO_FSRS = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy
} as const;

/**
 * Default parameters. Left untouched deliberately: FSRS's defaults are fitted against a
 * very large review corpus, and there is no local review history to optimise against until
 * the app has been used for months.
 */
const scheduler = fsrs({});

function toFsrs(card: ProgressCard): FsrsCard {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: 0, // deprecated upstream and recomputed on every call
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_TO_FSRS[card.state],
    last_review: card.lastReview === null ? undefined : new Date(card.lastReview)
  };
}

function fromFsrs(id: string, card: FsrsCard): ProgressCard {
  return {
    id,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_FROM_FSRS[card.state],
    lastReview: card.last_review ? card.last_review.getTime() : null
  };
}

/**
 * The blank card for an id that has never been reviewed. Cards are created lazily — a row
 * only exists once it has been graded once — so this is called at the moment of the first
 * review, never in bulk.
 */
export function newCard(id: string, now: Date = new Date()): ProgressCard {
  return fromFsrs(id, createEmptyCard(now));
}

/** Apply one review. Pure: returns the next card, writes nothing. */
export function grade(
  card: ProgressCard,
  rating: ReviewRating,
  now: Date = new Date()
): ProgressCard {
  const { card: next } = scheduler.next(toFsrs(card), now, RATING_TO_FSRS[rating]);
  return fromFsrs(card.id, next);
}

/** Is this card ready to be shown again? */
export function isDue(card: ProgressCard, now: number = Date.now()): boolean {
  return card.due <= now;
}

/**
 * Has this card graduated? `Review` is FSRS's own definition of "learned" — it is reached
 * by passing the learning steps, not by a threshold we invented. Mastery is built on this.
 */
export function isLearned(card: ProgressCard): boolean {
  return card.state === 'review';
}

/** The binary quiz answer a first review screen will produce. */
export function ratingForAnswer(correct: boolean): ReviewRating {
  return correct ? 'good' : 'again';
}
