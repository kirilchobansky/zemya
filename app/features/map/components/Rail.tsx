import type { PointerEvent as ReactPointerEvent } from 'react';
import { Link, useLocation, useMatch } from 'react-router';

import type { MasteryTotals, OverlayId } from '~/features/countries';
import { EdgeArrow } from './EdgeArrow';
import { LayerControls } from './LayerControls';
import { ProgressSection } from './ProgressSection';
import { DataSection } from './DataSection';
import { ThemeControls } from './ThemeControls';
import './Rail.css';

interface RailProps {
  overlay: OverlayId;
  onOverlayChange(overlay: OverlayId): void;
  countryCount: number;
  totals: MasteryTotals;
  /** Collapse/resize (desktop only — routes/map/atlas.tsx owns the width/collapsed state and
   *  the drag logic; this component only renders the controls and forwards the events). */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onHandlePointerDown: (e: ReactPointerEvent) => void;
  onHandleDoubleClick: () => void;
}

/** The four top-level sections, same set and same active-section rules the phone tab bar
 *  uses (MobileChrome.tsx's TabBar) — kept side by side so the two can't drift apart. */
const SECTIONS = [
  { to: '/', label: 'Map', isActive: (p: string) => p === '/' || p.startsWith('/country/') },
  { to: '/quizzes', label: 'Quizzes', isActive: (p: string) => p.startsWith('/quizzes') || p.startsWith('/quiz') },
  { to: '/questions', label: 'Questions', isActive: (p: string) => p === '/questions' || p === '/study' },
  { to: '/history', label: 'History', isActive: (p: string) => p.startsWith('/history') }
];

export function Rail({
  overlay, onOverlayChange, countryCount, totals,
  collapsed, onToggleCollapsed, onHandlePointerDown, onHandleDoubleClick
}: RailProps) {
  // A page's h1 is its subject: on a country page that is the country's name, so the
  // wordmark steps down to a plain block there and is the h1 everywhere else.
  const onCountry = useMatch('/country/:slug') !== null;
  const Wordmark = onCountry ? 'div' : 'h1';
  const { pathname } = useLocation();
  return (
    <aside className={`rail${collapsed ? ' rail--collapsed' : ''}`}>
      <div
        className="sidebar-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize · Double-click to reset"
        onPointerDown={onHandlePointerDown}
        onDoubleClick={onHandleDoubleClick}
      />
      {collapsed && (
        <button
          type="button"
          className="sidebar-edge-tab"
          title="Expand sidebar ([)"
          aria-label="Expand sidebar"
          onClick={onToggleCollapsed}
        >
          <EdgeArrow dir="right" />
        </button>
      )}

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
          Capitals: <a href="https://www.geonames.org/">GeoNames</a>, CC BY 4.0 · Data: ODbL ·{' '}
          <a href="https://github.com/kirilchobansky/zemya#data-sources">All sources</a>
        </p>
      </div>

      {/* bottom of the sidebar; collapsed, the expand tab on the screen edge (vertically centred) takes over */}
      <button
        type="button"
        className="sidebar-collapse"
        title={collapsed ? 'Expand sidebar ([)' : 'Collapse sidebar ([)'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick={onToggleCollapsed}
      >
        {collapsed ? '›' : '‹'}
      </button>
    </aside>
  );
}
