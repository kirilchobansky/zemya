/**
 * The phone shell's own furniture: the sheet's handle, the bottom tab bar and the two small
 * overlay sheets (Layers, Progress). All of it is in the DOM on every viewport and is
 * `display: none` above the phone width (app.css, `@media (max-width: 819px)`), so the desktop
 * layout and the prerendered HTML are the same for everyone.
 */
import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

import { DataSection, LayerControls, ProgressSection } from '~/components/Rail';
import type { MasteryTotals } from '~/lib/geography/mastery';
import type { OverlayId } from '~/lib/geography/overlays';
import type { SheetSnap } from '~/lib/sheet';

/** Stroke icons drawn inline: glyph characters (⏱, ◍) fall back to tofu on fonts without them,
 *  and a tab bar can't have one icon missing on one phone. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="tab__icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const LayersIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3 3 8l9 5 9-5-9-5Z" />
    <path d="m3 12.5 9 5 9-5" />
    <path d="m3 16.5 9 5 9-5" />
  </svg>
);

const NEXT_LABEL: Record<SheetSnap, string> = {
  peek: 'Expand panel',
  half: 'Expand panel to full height',
  full: 'Shrink panel'
};

/** The sheet's drag handle and ⌃ arrow. Dragging is wired by useSheetDrag on the whole panel;
 *  this is what a plain tap lands on, and the accessible name of the control. */
export function SheetGrip({ snap, onStep }: { snap: SheetSnap; onStep(): void }) {
  return (
    <button
      type="button"
      className="sheet__grip"
      aria-label={NEXT_LABEL[snap]}
      data-snap={snap}
      onClick={onStep}
    >
      <span className="sheet__pill" aria-hidden="true" />
      <span className="sheet__arrow" aria-hidden="true">⌃</span>
    </button>
  );
}

export type OverlayName = 'layers' | 'progress' | null;

export function TabBar({ overlay, onOverlay }: { overlay: OverlayName; onOverlay(next: OverlayName): void }) {
  const { pathname } = useLocation();
  const onMap = pathname === '/' || pathname.startsWith('/country/');
  const onQuiz = pathname.startsWith('/quizzes') || pathname.startsWith('/quiz');
  const onStudy = pathname === '/study';
  const close = () => onOverlay(null);

  // an overlay covers the section underneath, so it takes the highlight while it is open
  const tab = (active: boolean) => (active && !overlay ? 'page' : undefined);

  return (
    <nav className="tabbar" aria-label="Sections">
      <Link to="/" state={{ sheet: 'peek' }} className="tab" aria-current={tab(onMap)} onClick={close}>
        <Icon><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><ellipse cx="12" cy="12" rx="4" ry="9" /></Icon>
        <span className="tab__label">Map</span>
      </Link>
      <Link to="/quizzes" state={{ sheet: 'half' }} className="tab" aria-current={tab(onQuiz)} onClick={close}>
        <Icon><circle cx="12" cy="13.5" r="7.5" /><path d="M12 9.5v4l2.5 1.5M9.5 3h5" /></Icon>
        <span className="tab__label">Quizzes</span>
      </Link>
      <Link to="/study" state={{ sheet: 'half' }} className="tab" aria-current={tab(onStudy)} onClick={close}>
        <Icon><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5Z" /><path d="M12 6.5v13" /></Icon>
        <span className="tab__label">Study</span>
      </Link>
      <button
        type="button"
        className="tab"
        aria-current={overlay === 'progress' ? 'page' : undefined}
        aria-expanded={overlay === 'progress'}
        onClick={() => onOverlay(overlay === 'progress' ? null : 'progress')}
      >
        <Icon><path d="M12 3a9 9 0 1 0 9 9h-9V3Z" /><path d="M15.5 2.6A9 9 0 0 1 21.4 8.5H15.5V2.6Z" /></Icon>
        <span className="tab__label">Progress</span>
      </button>
    </nav>
  );
}

/** A small sheet that slides up over the map, above the tab bar. Not a route: it has no URL and
 *  no page, it is just a panel of controls. Closes on the backdrop, ×, or Escape. */
function OverlaySheet({
  open, title, onClose, children
}: { open: boolean; title: string; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className="ovl" data-open={open} inert={!open}>
      <div className="ovl__backdrop" onClick={onClose} />
      <section className="ovl__sheet" role="dialog" aria-label={title}>
        <header className="ovl__head">
          <h2>{title}</h2>
          <button type="button" className="ovl__close" onClick={onClose} aria-label={`Close ${title}`}>
            ×
          </button>
        </header>
        <div className="ovl__body">{open && children}</div>
      </section>
    </div>
  );
}

interface LayersSheetProps {
  open: boolean;
  onClose(): void;
  overlay: OverlayId;
  onOverlayChange(overlay: OverlayId): void;
  showNeighbours: boolean;
  onNeighbours(): void;
  showPins: boolean;
  onPins(): void;
  showCapitals: boolean;
  onCapitals(): void;
  comparing: boolean;
  onCompare(): void;
}

export function LayersSheet(props: LayersSheetProps) {
  const { open, onClose } = props;
  return (
    <OverlaySheet open={open} title="Layers" onClose={onClose}>
      <LayerControls overlay={props.overlay} onOverlayChange={props.onOverlayChange} />
      <section className="group">
        <h2 className="group__title">Show on the map</h2>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={props.showNeighbours} onClick={props.onNeighbours}>
            Neighbour glow
          </button>
          <button type="button" className="chip" aria-pressed={props.showPins} onClick={props.onPins}>
            Micro-states
          </button>
          <button type="button" className="chip" aria-pressed={props.showCapitals} onClick={props.onCapitals}>
            Capitals
          </button>
        </div>
      </section>
      <section className="group">
        <h2 className="group__title">Tools</h2>
        <div className="chips">
          <button
            type="button"
            className="chip"
            aria-pressed={props.comparing}
            onClick={() => {
              props.onCompare();
              onClose();
            }}
          >
            ⇲ Compare size
          </button>
        </div>
      </section>
    </OverlaySheet>
  );
}

export function ProgressSheet({
  open, onClose, totals
}: { open: boolean; onClose(): void; totals: MasteryTotals }) {
  return (
    <OverlaySheet open={open} title="Progress" onClose={onClose}>
      <ProgressSection totals={totals} />
      <DataSection />
    </OverlaySheet>
  );
}
