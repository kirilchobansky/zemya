import { Link } from 'react-router';

import { legendFor, OVERLAYS, type OverlayId } from '~/lib/geography/overlays';

interface RailProps {
  overlay: OverlayId;
  onOverlayChange(overlay: OverlayId): void;
  countryCount: number;
}

export function Rail({ overlay, onOverlayChange, countryCount }: RailProps) {
  const legend = legendFor(overlay);

  return (
    <aside className="rail">
      <div className="brand">
        <div className="brand__mark" aria-hidden="true" />
        <div>
          <h1>
            <Link to="/">Zemya</Link>
          </h1>
          <p>Cognitive Geography</p>
        </div>
      </div>

      <div className="rail__scroll">
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

        <section className="group">
          <h2 className="group__title">How to use it</h2>
          <div className="note">
            Click any country to open its dossier. Its land neighbours light up in blue, so
            you learn the shape of a region rather than one country at a time.
          </div>
          <div className="note">
            <b>Compare size</b> lifts a country's outline off the map. Drag it over another
            and its true ground area is preserved — Mercator's distortion becomes visible
            instead of invisible.
          </div>
        </section>
      </div>

      <div className="rail__foot">
        <span>{countryCount || '—'} states</span>
        <span>Pre-alpha</span>
      </div>
    </aside>
  );
}
