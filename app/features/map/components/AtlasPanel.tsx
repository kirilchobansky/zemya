import type { PointerEvent, RefObject } from 'react';
import { Outlet } from 'react-router';

import { stepSnap, type SheetSnap } from '~/shared/layout/sheet';
import { EdgeArrow } from './Rail';
import { SheetGrip } from './MobileChrome';
import { UpButton } from './UpButton';

/** The right-hand panel (desktop) / bottom sheet (phone): the sidebar handle, Up button and
 *  collapse controls around the route's own content (<Outlet />). */
export function AtlasPanel({
  panelRef, snap, onSnap, twoStop, immersive, phone, panelCollapsed, onStartDrag, onResetWidth, onToggleCollapsed
}: {
  panelRef: RefObject<HTMLElement | null>;
  snap: SheetSnap;
  onSnap: (snap: SheetSnap) => void;
  twoStop: boolean;
  immersive: boolean;
  phone: boolean;
  panelCollapsed: boolean;
  onStartDrag: (e: PointerEvent<Element>) => void;
  onResetWidth: () => void;
  onToggleCollapsed: () => void;
}) {
  return (
    <aside
      className="panel"
      ref={panelRef}
      data-snap={snap}
      data-hidden={immersive}
      data-collapsed={!phone && panelCollapsed}
      aria-hidden={phone && immersive ? true : undefined}
    >
      {!phone && (
        <>
          <div
            className="sidebar-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            title="Drag to resize · Double-click to reset"
            onPointerDown={onStartDrag}
            onDoubleClick={onResetWidth}
          />
          {!panelCollapsed && <UpButton />}
          {panelCollapsed && (
            <button
              type="button"
              className="sidebar-edge-tab"
              title="Expand panel (])"
              aria-label="Expand panel"
              onClick={onToggleCollapsed}
            >
              <EdgeArrow dir="left" />
            </button>
          )}
        </>
      )}
      <div className="panel__content">
        <SheetGrip snap={snap} twoStop={twoStop} onStep={() => onSnap(stepSnap(snap, twoStop))} />
        <Outlet />
      </div>
      {!phone && !panelCollapsed && (
        <button
          type="button"
          className="sidebar-collapse"
          title="Collapse panel (])"
          aria-label="Collapse panel"
          onClick={onToggleCollapsed}
        >
          ›
        </button>
      )}
    </aside>
  );
}
