import { keepFocus } from './QuizControls';
import './MissingSwitch.css';

/** The "Show missing" on/off switch every map quiz shares: a label and a small knob that slides
 *  from left (off) to right (on). `compact` is the phone HUD's smaller one. Never takes focus,
 *  so tapping it leaves the answer input (and the phone keyboard) alone. */
export function MissingSwitch({ on, onToggle, compact = false }: { on: boolean; onToggle: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`missing-switch${compact ? ' missing-switch--compact' : ''}`}
      title="Mark the countries you have not got yet"
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={onToggle}
    >
      <span className="missing-switch__label">Show missing</span>
      <span className="missing-switch__track" aria-hidden="true">
        <span className="missing-switch__knob" />
      </span>
    </button>
  );
}
