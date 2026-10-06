/**
 * Where a quiz run's own chrome covers the map — shared by the geography run
 * (routes/quizzes/quizzes.$subject.$quizId.tsx) and "Name all countries" (features/quizzes/name-all/NameAllQuiz.tsx),
 * which both dock an input over the canvas and, on a phone, a HUD above it.
 */
import { NO_INSETS, type Insets } from '~/engines/map/follow';
import { isPhoneLandscape, isPhoneLayout } from '~/shared/layout/viewport';

/** What sits on top of the canvas during a run, so a target hidden under it counts as not
 *  visible. Desktop: the docked input, at the bottom. The right-hand panel is a grid column
 *  BESIDE the stage, not over it, so a country 'behind the panel' is simply off the canvas and
 *  needs no inset. Phone: the strip between the HUD (top) and the input bar (bottom, sitting on
 *  the keyboard) — measured from the DOM, so it is whatever the keyboard has made it right now. */
export function measureInsets(): Insets {
  const canvas = document.querySelector('.stage__canvas');
  if (!canvas) return NO_INSETS;
  const c = canvas.getBoundingClientRect();
  if (!isPhoneLayout()) {
    const dock = document.querySelector('.quiz-dock');
    if (!dock) return NO_INSETS;
    return {
      ...NO_INSETS,
      bottom: Math.max(0, c.bottom - dock.getBoundingClientRect().top),
    };
  }
  const hud = document.querySelector('.quiz-hud');
  const bar = document.querySelector('.quiz-controls');
  if (!hud || !bar) return NO_INSETS;
  if (isPhoneLandscape()) {
    // landscape: the HUD sits inline at the left of the input bar, both on the keyboard; the
    // answer chip floats just above them. The map gets everything above that.
    const feedback = document.querySelector('.quiz-controls .quiz-feedback');
    const barTop = Math.min(
      hud.getBoundingClientRect().top,
      bar.getBoundingClientRect().top,
      feedback ? feedback.getBoundingClientRect().top : Infinity,
    );
    return { ...NO_INSETS, bottom: Math.max(0, c.bottom - barTop) };
  }
  return {
    ...NO_INSETS,
    top: Math.max(0, hud.getBoundingClientRect().bottom - c.top),
    bottom: Math.max(0, c.bottom - bar.getBoundingClientRect().top),
  };
}

