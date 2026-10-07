import { keepFocus } from '~/features/quizzes/engine/QuizControls';
import type { FillQuiz } from './fill-quiz';

/** The quiz's optional toggle (e.g. "elected only"). `hidden` keeps its space once a run starts
 *  so the grid below never jumps. */
export function FillToggle({ quiz, checked, onChange, hidden }: {
  quiz: FillQuiz;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hidden: boolean;
}) {
  if (!quiz.toggle) return null;
  return (
    <label
      className={`fill-quiz__toggle${hidden ? ' fill-quiz__toggle--off' : ''}`}
      onMouseDown={keepFocus}
      onPointerDown={keepFocus}
    >
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {quiz.toggle.label}
    </label>
  );
}
