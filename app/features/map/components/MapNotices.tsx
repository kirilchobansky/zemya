import type { Feature, PlaceMark } from '~/engines/map/types';

/** Floating notices over the map: the hover tooltip, the compare-size explainer, and a
 *  data-load error. */
export function MapNotices({ showTimeline, quiz, coarse, hovered, hoveredPlace, tip, comparing, armingCompare, onCompare, error }: {
  showTimeline: boolean;
  quiz: boolean;
  coarse: boolean;
  hovered: Feature | null;
  hoveredPlace: PlaceMark | null;
  tip: { x: number; y: number } | null;
  comparing: { feature: Feature; over: Feature | null } | null;
  armingCompare: boolean;
  onCompare: () => void;
  error: string | null;
}) {
  return (
    <>
    {!quiz && !showTimeline && hovered && tip && !coarse && (
      <div className="tip glass" style={{ left: tip.x, top: tip.y }}>
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

    {!showTimeline && error && (
      <div className="compare-hud glass">
        <p>The map data failed to load ({error}). Reloading usually fixes it.</p>
      </div>
    )}
    </>
  );
}

function ratio(a: number, b: number): string {
  const r = a / b;
  return r >= 1 ? `${r.toFixed(1)}× larger` : `${(1 / r).toFixed(1)}× smaller`;
}
