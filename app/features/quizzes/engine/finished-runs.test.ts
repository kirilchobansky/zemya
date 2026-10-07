import { afterEach, describe, expect, it, vi } from 'vitest';

import { holdQuizCamera, quizCameraHeld, saveFinishedRun, savedFinishedRun } from './finished-runs';

afterEach(() => vi.useRealTimers());

describe('finished-runs', () => {
  it('returns a saved run only for its own key and token', () => {
    const run = { phase: 'done' };
    saveFinishedRun('/quizzes/geography/name-all/africa/all', 'a', run);
    expect(savedFinishedRun('/quizzes/geography/name-all/africa/all', 'a')).toBe(run);
    expect(savedFinishedRun('/quizzes/geography/name-all/africa/all', 'b')).toBeNull();
    expect(savedFinishedRun('/elsewhere', 'a')).toBeNull();
  });

  it('holds the camera only briefly after a results link is followed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(quizCameraHeld()).toBe(false);
    holdQuizCamera();
    expect(quizCameraHeld()).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(quizCameraHeld()).toBe(false);
  });
});
