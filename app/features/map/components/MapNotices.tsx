import type { RefObject } from 'react';

import { STEP_LABEL, type LoadFailure } from '~/engines/map/load-error';
import type { RetryInfo } from '~/engines/map/retry';
import type { Feature, PlaceMark } from '~/engines/map/types';

/** Floating notices over the map: the hover tooltip, the compare-size explainer, and a
 *  data-load error. */
export function MapNotices({ showTimeline, quiz, coarse, hovered, hoveredPlace, tip, tipRef, comparing, armingCompare, onCompare, error, retrying, restoring, onRetry }: {
  showTimeline: boolean;
  quiz: boolean;
  coarse: boolean;
  hovered: Feature | null;
  hoveredPlace: PlaceMark | null;
  tip: { x: number; y: number } | null;
  tipRef: RefObject<HTMLDivElement | null>;
  comparing: { feature: Feature; over: Feature | null } | null;
  armingCompare: boolean;
  onCompare: () => void;
  error: LoadFailure | null;
  retrying: RetryInfo | null;
  restoring: boolean;
  onRetry: () => void;
}) {
  return (
    <>
    {!quiz && !showTimeline && hovered && tip && !coarse && (
      <div ref={tipRef} className="tip glass" style={{ left: tip.x, top: tip.y }}>
        <span>{hovered.country.emoji}</span>
        <span>{hoveredPlace ? hoveredPlace.place.name : hovered.country.name}</span>
      </div>
    )}


    {!showTimeline && (comparing || armingCompare) && (
      <div className="compare-hud glass">
        <p>
          {armingCompare ? (
            <>
              <span className="only-fine">Click</span>
              <span className="only-coarse">Tap</span> any country to lift its outline off the map.
            </>
          ) : comparing ? (
            <>
              <b>{comparing.feature.country.emoji} {comparing.feature.country.name}</b> —{' '}
              {comparing.feature.country.area.toLocaleString()} km². Drag it anywhere; on a
              Mercator map its true ground size is preserved.
              {comparing.over && comparing.over.country.area > 0 && (
                <>
                  <br />
                  Sitting over <b>{comparing.over.country.name}</b> —{' '}
                  {ratio(comparing.feature.country.area, comparing.over.country.area)}.
                </>
              )}
            </>
          ) : null}
        </p>
        <button type="button" className="action" onClick={onCompare}>
          {armingCompare ? 'Cancel' : 'Put it back'}
        </button>
      </div>
    )}

    {!showTimeline && !error && restoring && (
      <div className="compare-hud glass" role="status">
        <p>Restoring the map…</p>
      </div>
    )}

    {!showTimeline && !error && retrying && (
      <div className="compare-hud glass" role="status">
        <p>
          Retrying… {STEP_LABEL[retrying.step]} failed (attempt {retrying.attempt} of {retrying.attempts}):{' '}
          {retrying.error.message}
        </p>
      </div>
    )}

    {!showTimeline && error && (
      <div className="compare-hud glass" role="alert">
        <p>
          {error.step === 'webgl'
            ? 'The map needs WebGL, and this browser could not start it. Check that hardware acceleration is on, or try another browser.'
            : 'The map failed to load.'}
          <br />
          <small>Failed step: {STEP_LABEL[error.step]} — {error.message}</small>
        </p>
        <button type="button" className="action" onClick={onRetry}>Retry</button>
      </div>
    )}
    </>
  );
}

function ratio(a: number, b: number): string {
  const r = a / b;
  return r >= 1 ? `${r.toFixed(1)}× larger` : `${(1 / r).toFixed(1)}× smaller`;
}
