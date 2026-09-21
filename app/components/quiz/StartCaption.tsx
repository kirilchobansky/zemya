/**
 * What sits under START on a phone, where the run's panel (which says the same thing on desktop)
 * is hidden. By POINTER, not width: a touch screen is told to tap, a narrow desktop window is
 * still told about the keys. Hidden entirely on the desktop layout.
 */
export function StartCaption() {
  return (
    <p className="quiz-dock__caption">
      <span className="only-fine">Press START — or Space, or Enter — to begin.</span>
      <span className="only-coarse">Tap START to begin.</span> Nothing is timed until you do.
    </p>
  );
}
