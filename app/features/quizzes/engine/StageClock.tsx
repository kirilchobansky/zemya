import { createPortal } from 'react-dom';

import { formatDuration } from '~/shared/lib/format';

/**
 * The run timer on the desktop stage, top-left, for the one moment the panel's own timer is out
 * of sight: the right panel collapsed (app.css shows this only then). Overlaid, so it moves
 * nothing; above the flag stage, the map and the pause cover. Phone has its HUD instead.
 */
export function StageClock({ host, ms }: { host: Element | null; ms: number }) {
  if (!host) return null;
  return createPortal(<div className="quiz-clock-desk numeric" aria-hidden="true">{formatDuration(ms)}</div>, host);
}
