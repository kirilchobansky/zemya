import { useState } from 'react';
import { Link, useLocation, useMatch } from 'react-router';

import { useProgress } from '~/lib/core/ProgressProvider';
import { legendFor, MASTERY_COLOURS, OVERLAYS, type OverlayId } from '~/lib/geography/overlays';
import type { MasteryTotals } from '~/lib/geography/mastery';
import { setTheme, useTheme, type Theme } from '~/lib/theme';

interface RailProps {
  overlay: OverlayId;
  onOverlayChange(overlay: OverlayId): void;
  countryCount: number;
  totals: MasteryTotals;
}

/** The four top-level sections, same set and same active-section rules the phone tab bar
 *  uses (MobileChrome.tsx's TabBar) — kept side by side so the two can't drift apart. */
const SECTIONS = [
  { to: '/', label: 'Map', isActive: (p: string) => p === '/' || p.startsWith('/country/') },
  { to: '/quizzes', label: 'Quizzes', isActive: (p: string) => p.startsWith('/quizzes') || p.startsWith('/quiz') },
  { to: '/questions', label: 'Questions', isActive: (p: string) => p === '/questions' || p === '/study' },
  { to: '/history', label: 'History', isActive: (p: string) => p.startsWith('/history') }
];

export function Rail({ overlay, onOverlayChange, countryCount, totals }: RailProps) {
  // A page's h1 is its subject: on a country page that is the country's name, so the
  // wordmark steps down to a plain block there and is the h1 everywhere else.
  const onCountry = useMatch('/country/:slug') !== null;
  const Wordmark = onCountry ? 'div' : 'h1';
  const { pathname } = useLocation();
  return (
    <aside className="rail">
      <div className="brand">
        <div className="brand__mark" aria-hidden="true" />
        <div>
          <Wordmark className="brand__name">
            <Link to="/">Zemya</Link>
          </Wordmark>
          <p>Cognitive Geography</p>
        </div>
      </div>

      <div className="rail__scroll">
        <section className="group">
          <nav className="actions" aria-label="Sections">
            {SECTIONS.map(section => (
              <Link
                key={section.to}
                to={section.to}
                className="action action--primary"
                aria-current={section.isActive(pathname) ? 'page' : undefined}
                style={{ flex: '1 0 40%', textAlign: 'center' }}
              >
                {section.label}
              </Link>
            ))}
          </nav>
        </section>

        <LayerControls overlay={overlay} onOverlayChange={onOverlayChange} />

        <ProgressSection totals={totals} />

        <ThemeControls />

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

        <DataSection />
      </div>

      <div className="rail__foot">
        <span>{countryCount || '—'} states</span>
        <span>Pre-alpha</span>
        <p className="rail__credit">
          Capitals: <a href="https://www.geonames.org/">GeoNames</a>, CC BY 4.0 ·{' '}
          <a href="https://github.com/kirilchobansky/zemya#data-sources">All sources</a>
        </p>
      </div>
    </aside>
  );
}

/** The map-overlay chips and their legend. Shared by the desktop rail and the phone Layers sheet. */
export function LayerControls({
  overlay,
  onOverlayChange
}: Pick<RailProps, 'overlay' | 'onOverlayChange'>) {
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

/** Mastered / learning / new, as a tally and a meter. */
export function ProgressSection({ totals }: Pick<RailProps, 'totals'>) {
  useTheme(); // MASTERY_COLOURS is a getComputedStyle cache — see LayerControls's note
  const pct = (n: number) => (totals.total ? (n / totals.total) * 100 : 0);
  return (
    <section className="group">
      <h2 className="group__title">Your progress</h2>
      <div className="tally" data-testid="tally">
        <div className="tally__cell">
          <span className="tally__n numeric" style={{ color: MASTERY_COLOURS.mastered }}>
            {totals.mastered}
          </span>
          <span className="tally__label">Mastered</span>
        </div>
        <div className="tally__cell">
          <span className="tally__n numeric" style={{ color: MASTERY_COLOURS.learning }}>
            {totals.learning}
          </span>
          <span className="tally__label">Learning</span>
        </div>
        <div className="tally__cell">
          <span className="tally__n numeric" style={{ color: MASTERY_COLOURS.new }}>
            {totals.new}
          </span>
          <span className="tally__label">New</span>
        </div>
      </div>
      <div
        className="meter"
        role="img"
        aria-label={`${totals.mastered} mastered and ${totals.learning} learning of ${totals.total}`}
      >
        <span
          className="meter__seg"
          style={{ width: `${pct(totals.mastered)}%`, background: MASTERY_COLOURS.mastered }}
        />
        <span
          className="meter__seg"
          style={{ width: `${pct(totals.learning)}%`, background: MASTERY_COLOURS.learning }}
        />
      </div>
    </section>
  );
}

/** Export / Import / Reset. Owns its own status line, so wherever it is mounted it reports
 *  its result right beside the buttons. */
export function DataSection() {
  const { exportJson, importJson, reset } = useProgress();
  const [status, setStatus] = useState<string | null>(null);

  /**
   * Clipboard first, `prompt()` when it is unavailable or refused — the API needs a secure
   * context and a permission the user may not have granted, and losing the only copy of
   * someone's progress to a silent rejection is not acceptable.
   */
  async function handleExport() {
    const json = await exportJson();
    try {
      await navigator.clipboard.writeText(json);
      setStatus(`Copied ${json.length.toLocaleString()} characters to the clipboard.`);
    } catch {
      window.prompt('Copy your progress:', json);
      setStatus('Clipboard unavailable — copy the text from the dialog.');
    }
  }

  async function handleImport() {
    const text = window.prompt('Paste a Zemya export:');
    if (!text) return;
    try {
      const count = await importJson(text);
      setStatus(`Imported ${count.toLocaleString()} cards.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Import failed.');
    }
  }

  async function handleReset() {
    if (!window.confirm('Erase all progress on this device? This cannot be undone.')) return;
    await reset();
    setStatus('Progress erased.');
  }

  return (
    <section className="group">
      <h2 className="group__title">Your data</h2>
      <div className="note">
        Progress lives in this browser only. Nothing is uploaded, so moving to another
        device means exporting and importing it yourself.
      </div>
      <div className="actions">
        <button type="button" className="action" onClick={handleExport}>
          Export
        </button>
        <button type="button" className="action" onClick={handleImport}>
          Import
        </button>
        <button type="button" className="action" onClick={handleReset}>
          Reset
        </button>
      </div>
      {status && <div className="note note--status">{status}</div>}
    </section>
  );
}

const THEME_OPTIONS: { id: Theme; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' }
];

/** The System / Light / Dark switch. Shared by the desktop rail and the phone Layers sheet,
 *  same pattern as LayerControls. */
export function ThemeControls() {
  const theme = useTheme();
  return (
    <section className="group">
      <h2 className="group__title">Appearance</h2>
      <div className="chips">
        {THEME_OPTIONS.map(o => (
          <button
            key={o.id}
            type="button"
            className="chip"
            aria-pressed={theme === o.id}
            onClick={() => setTheme(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}
