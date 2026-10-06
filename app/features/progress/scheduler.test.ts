/**
 * Unit tests for the scheduler wrapper (app/lib/core/scheduler.ts) in isolation from
 * persistence, React, and geography. These exercise ts-fsrs through our own grade() /
 * isLearned() surface — if this passes, the algorithm itself is doing what the app assumes
 * it does, independent of whether the store or the UI wire it up correctly.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from 'vitest';

import { grade, isLearned, newCard, type ProgressCard } from '~/lib/core/scheduler';

/** Grade `rating` and advance the simulated clock to the card's own new due date, so each
 *  subsequent review happens exactly when FSRS scheduled it — the realistic case, and the
 *  one that lets `scheduledDays` grow the way a real study session would produce. */
function reviewOnSchedule(card: ProgressCard, rating: 'good' | 'again', now: Date): ProgressCard {
  return grade(card, rating, now);
}

describe('grading Good repeatedly', () => {
  it('graduates a fresh card to Review and keeps growing its interval', () => {
    let now = new Date('2026-01-01T00:00:00Z');
    let card = newCard('geo:TEST:capital', now);
    expect(card.state).toBe('new');

    // FSRS's default learning steps are 1m then 10m — two `good` grades pass both and
    // graduate the card, regardless of how much wall-clock time actually elapses between
    // calls (verified separately: this is step-driven, not clock-driven).
    card = reviewOnSchedule(card, 'good', now);
    expect(card.state).toBe('learning');
    card = reviewOnSchedule(card, 'good', now);
    expect(card.state).toBe('review');
    expect(isLearned(card)).toBe(true);

    // Keep reviewing Good, each time exactly when the card falls due — this is the
    // condition under which FSRS is expected to lengthen the interval, since consistent
    // successful recall raises stability.
    const intervals: number[] = [card.scheduledDays];
    for (let i = 0; i < 5; i++) {
      now = new Date(card.due);
      card = reviewOnSchedule(card, 'good', now);
      expect(card.state).toBe('review'); // never drops out of Review on a correct answer
      intervals.push(card.scheduledDays);
    }

    for (let i = 1; i < intervals.length; i++) {
      expect(
        intervals[i],
        `interval after Good #${i} did not grow: ${intervals.join(' -> ')}`
      ).toBeGreaterThan(intervals[i - 1]);
    }
  });
});

describe('grading Again on a learned card', () => {
  it('drops the card out of Review and shrinks its interval', () => {
    let now = new Date('2026-01-01T00:00:00Z');
    let card = newCard('geo:TEST:flag', now);

    // reach Review, then let a few successful reviews build up a real interval to fall from
    card = reviewOnSchedule(card, 'good', now);
    card = reviewOnSchedule(card, 'good', now);
    for (let i = 0; i < 3; i++) {
      now = new Date(card.due);
      card = reviewOnSchedule(card, 'good', now);
    }
    expect(card.state).toBe('review');
    const intervalBeforeLapse = card.scheduledDays;
    expect(intervalBeforeLapse).toBeGreaterThan(1); // a real multi-day interval, not a stub

    now = new Date(card.due); // reviewed exactly when due, and gotten wrong
    const lapsed = reviewOnSchedule(card, 'again', now);

    expect(lapsed.state).not.toBe('review');
    expect(isLearned(lapsed)).toBe(false);
    expect(lapsed.lapses).toBe(card.lapses + 1);
    expect(
      lapsed.scheduledDays,
      `interval did not shrink on a lapse: ${intervalBeforeLapse} -> ${lapsed.scheduledDays}`
    ).toBeLessThan(intervalBeforeLapse);
  });
});
