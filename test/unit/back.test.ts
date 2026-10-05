/**
 * The Back button's fallback target (app/lib/back.ts): the logical parent of each kind of page.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from 'vitest';

import { parentPath } from '~/lib/back';

describe('parentPath', () => {
  it('has no parent on the home screen', () => {
    expect(parentPath('/')).toBeNull();
  });
  it('sends top-level pages and countries to the map', () => {
    for (const p of ['/country/france', '/questions', '/study', '/history', '/quizzes', '/quiz']) {
      expect(parentPath(p)).toBe(p === '/quiz' ? '/quizzes' : '/');
    }
  });
  it('walks quizzes: run -> list -> subject list -> Quizzes', () => {
    expect(parentPath('/quizzes/geography/countries/europe/20')).toBe('/quizzes/geography');
    expect(parentPath('/quizzes/geography/name-all/world/all')).toBe('/quizzes/geography');
    expect(parentPath('/quizzes/geography')).toBe('/quizzes');
    expect(parentPath('/quizzes/history')).toBe('/quizzes');
    expect(parentPath('/quizzes/history/bulgaria')).toBe('/quizzes/history');
    expect(parentPath('/quizzes/history/bulgaria/rulers')).toBe('/quizzes/history/bulgaria');
  });
  it('walks history: item/timeline -> History list', () => {
    expect(parentPath('/history/bulgaria')).toBe('/history');
    expect(parentPath('/history/bulgaria/list')).toBe('/history/bulgaria');
  });
});
