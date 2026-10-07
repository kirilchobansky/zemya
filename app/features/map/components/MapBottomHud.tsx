import type { MapController } from '~/engines/map/controller';

/** The bottom bar over the map: zoom buttons, reset view and the scale bar. */
export function MapBottomHud({ atlasRef, quiz, onHome, scale }: {
  atlasRef: { current: MapController | null };
  quiz: boolean;
  /** Navigate to the world view's URL; skipped during a quiz run (see below). */
  onHome: () => void;
  scale: { km: number; px: number };
}) {
  return (
    <div className="hud hud--bottom">
      <div className="zoomer glass">
        <button type="button" className="zoom-step" onClick={() => atlasRef.current?.zoomBy(1.7)} aria-label="Zoom in">+</button>
        <button type="button" className="zoom-step" onClick={() => atlasRef.current?.zoomBy(1 / 1.7)} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => {
          // during a run ⌂ is only a camera reset: navigating to '/' would unmount the
          // quiz route and silently abandon the run (the same trap as a map click)
          if (!quiz) onHome();
          atlasRef.current?.home();
        }} aria-label="Reset view">⌂</button>
      </div>
      <div className="scalebar glass">
        {scale.km ? `${scale.km.toLocaleString()} km` : '—'}
        <div className="scalebar__bar" style={{ width: `${Math.round(scale.px)}px` }} />
      </div>
    </div>
  );
}
