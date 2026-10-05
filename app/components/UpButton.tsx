import { useCallback, useContext } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { AtlasContext } from '~/lib/atlas-context';
import { parentPath } from '~/lib/up';

/**
 * The right panel's Up button, on the header's first line at its left (the eyebrow is indented
 * to make room, app.css `.panel__up`). One level up in the fixed hierarchy of app/lib/up.ts;
 * renders nothing where there is no level above.
 */
export function UpButton() {
  const ctx = useContext(AtlasContext);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const parent = parentPath(pathname);
  // an opened History entry first, then the route's own level (a run), then the parent URL
  const detailOpen = ctx?.selectedHistoryEntryId != null;
  const setDetail = ctx?.setSelectedHistoryEntryId;
  const routeStep = ctx?.upStep ?? null;

  const goUp = useCallback(() => {
    if (detailOpen && setDetail) setDetail(null);
    else if (routeStep) routeStep();
    else if (parent !== null) navigate(parent, { state: { sheet: 'full' } });
  }, [detailOpen, setDetail, routeStep, parent, navigate]);

  if (!detailOpen && !routeStep && parent === null) return null;
  return (
    <button type="button" className="panel__up" title="Up one level" aria-label="Back, up one level" onClick={goUp}>
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 12H5M11 6l-6 6 6 6" />
      </svg>
      Back
    </button>
  );
}
