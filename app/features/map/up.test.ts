import { describe, expect, it } from 'vitest';

import { parentPath } from '~/lib/up';

describe('parentPath (the Up hierarchy)', () => {
  it('has no Up on the map, country pages, Questions and each section root', () => {
    for (const p of ['/', '/country/bulgaria', '/questions', '/quizzes', '/history']) {
      expect(parentPath(p)).toBeNull();
    }
  });
  it('walks the Quizzes tree one level at a time', () => {
    expect(parentPath('/quizzes/geography')).toBe('/quizzes');
    expect(parentPath('/quizzes/geography/countries/world/all')).toBe('/quizzes/geography');
    expect(parentPath('/quizzes/history')).toBe('/quizzes');
    expect(parentPath('/quizzes/history/bulgaria')).toBe('/quizzes/history');
    expect(parentPath('/quizzes/history/bulgaria/rulers')).toBe('/quizzes/history/bulgaria');
  });
  it('History: a country timeline goes up to the list', () => {
    expect(parentPath('/history/bulgaria')).toBe('/history');
  });
});
