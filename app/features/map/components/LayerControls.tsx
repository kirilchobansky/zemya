import { legendFor, OVERLAYS, type OverlayId } from '~/features/countries';
import { useTheme } from '~/shared/lib/theme';

/** The map-overlay chips and their legend. Shared by the desktop rail and the phone Layers sheet. */
export function LayerControls({
  overlay,
  onOverlayChange
}: {
  overlay: OverlayId;
  onOverlayChange(overlay: OverlayId): void;
}) {
  // legendFor()'s swatches are a getComputedStyle cache (overlays.ts), refreshed on a theme
  // change but not re-read on their own — subscribing forces this component (and the legend
  // it owns) to re-render so the swatches pick the fresh values up.
  useTheme();
  const legend = legendFor(overlay);
  return (
    <section className="group">
      <h2 className="group__title">Map overlay</h2>
      <div className="chips">
        {OVERLAYS.map(o => (
          <button
            key={o.id}
            type="button"
            className="chip"
            aria-pressed={overlay === o.id}
            onClick={() => onOverlayChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="legend">
        <div className="legend__title">{legend.title}</div>
        {legend.entries.map(entry => (
          <div className="legend__row" key={entry.label}>
            <span className="legend__swatch" style={{ background: entry.colour }} />
            {entry.label}
          </div>
        ))}
      </div>
    </section>
  );
}
