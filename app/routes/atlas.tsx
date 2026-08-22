/**
 * The atlas shell. Owns the canvas, the camera and every piece of map state; the child
 * routes render only the right-hand panel. Selection lives in the URL, so the back button
 * flies the camera and a country page can be linked to directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { Rail } from '~/components/Rail';
import { SearchBox } from '~/components/SearchBox';
import { Atlas } from '~/lib/map/atlas';
import type { Feature, World } from '~/lib/map/types';
import { loadWorld } from '~/lib/geography/world';
import { fillFor, strokeFor, type OverlayId } from '~/lib/geography/overlays';

const COUNTRY_PATH = /^\/country\/([^/]+)\/?$/;

export default function AtlasLayout() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const atlasRef = useRef<Atlas | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<OverlayId>('terrain');
  const [showNeighbours, setShowNeighbours] = useState(true);
  const [showPins, setShowPins] = useState(true);
  const [hovered, setHovered] = useState<Feature | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState({ km: 0, px: 0 });
  const [comparing, setComparing] = useState<{ feature: Feature; over: Feature | null } | null>(null);
  const [armingCompare, setArmingCompare] = useState(false);

  const slug = COUNTRY_PATH.exec(location.pathname)?.[1] ?? null;
  const selected = slug && world ? world.bySlug.get(slug) ?? null : null;

  /* the style callbacks the renderer calls per country, per frame */
  const styleInputs = useMemo(
    () => ({ overlay, selected, hovered, showNeighbours }),
    [overlay, selected, hovered, showNeighbours]
  );

  useEffect(() => {
    let cancelled = false;
    loadWorld().then(
      w => { if (!cancelled) setWorld(w); },
      e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
    );
    return () => { cancelled = true; };
  }, []);

  const handleSelect = useCallback(
    (feature: Feature | null) => {
      if (armingCompare) {
        if (feature && atlasRef.current?.startCompare(feature)) {
          setArmingCompare(false);
          setComparing({ feature, over: null });
        }
        return;
      }
      navigate(feature ? `/country/${feature.country.slug}` : '/');
    },
    [armingCompare, navigate]
  );

  /* keep the latest callbacks reachable without rebuilding the controller */
  const handleSelectRef = useRef(handleSelect);
  handleSelectRef.current = handleSelect;
  const styleRef = useRef(styleInputs);
  styleRef.current = styleInputs;

  /* create the controller once the payload has arrived */
  useEffect(() => {
    if (!world || !canvasRef.current || atlasRef.current) return;
    const atlas = new Atlas(
      canvasRef.current,
      world,
      {
        onHover: (feature, x, y) => {
          setHovered(feature);
          setTip(feature ? { x, y } : null);
        },
        onSelect: f => handleSelectRef.current(f),
        onCameraChange: setScale,
        onCompareMove: (feature, over) => setComparing({ feature, over })
      },
      {
        fill: f => fillFor(f, styleRef.current),
        stroke: f => strokeFor(f, styleRef.current),
        showLabels: true,
        showPins: true
      }
    );
    atlas.setUiFont(
      getComputedStyle(document.body).getPropertyValue('--font-ui') || 'system-ui, sans-serif'
    );
    atlasRef.current = atlas;
    return () => {
      atlas.destroy();
      atlasRef.current = null;
    };
  }, [world]);

  /* restyle whenever anything visual changes */
  useEffect(() => {
    atlasRef.current?.setStyle({
      fill: f => fillFor(f, styleRef.current),
      stroke: f => strokeFor(f, styleRef.current),
      showLabels: true,
      showPins
    });
  }, [styleInputs, showPins]);

  /* fly to whatever the URL says is selected */
  useEffect(() => {
    if (!atlasRef.current) return;
    if (selected) atlasRef.current.flyTo(selected);
    else atlasRef.current.home();
  }, [selected]);

  const toggleCompare = () => {
    if (comparing || armingCompare) {
      atlasRef.current?.stopCompare();
      setComparing(null);
      setArmingCompare(false);
      return;
    }
    if (selected && atlasRef.current?.startCompare(selected)) {
      setComparing({ feature: selected, over: null });
      return;
    }
    setArmingCompare(true);
  };

  const canvasClass = [
    'stage__canvas',
    armingCompare ? 'is-picking' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className="shell">
      <Rail
        overlay={overlay}
        onOverlayChange={setOverlay}
        countryCount={world?.features.length ?? 0}
      />

      <main className="stage">
        <canvas ref={canvasRef} className={canvasClass} aria-label="World map" />

        <div className="hud hud--top">
          <SearchBox
            world={world}
            onPick={feature => navigate(`/country/${feature.country.slug}`)}
          />
          <div className="toolbar glass">
            <button
              type="button"
              className="tool"
              aria-pressed={Boolean(comparing) || armingCompare}
              onClick={toggleCompare}
            >
              ⇲ Compare size
            </button>
            <button
              type="button"
              className="tool"
              aria-pressed={showNeighbours}
              onClick={() => setShowNeighbours(v => !v)}
            >
              Neighbour glow
            </button>
            <button
              type="button"
              className="tool"
              aria-pressed={showPins}
              onClick={() => setShowPins(v => !v)}
            >
              Micro-states
            </button>
          </div>
        </div>

        <div className="hud hud--bottom">
          <div className="zoomer glass">
            <button type="button" onClick={() => atlasRef.current?.zoomBy(1.7)} aria-label="Zoom in">+</button>
            <button type="button" onClick={() => atlasRef.current?.zoomBy(1 / 1.7)} aria-label="Zoom out">−</button>
            <button type="button" onClick={() => { navigate('/'); atlasRef.current?.home(); }} aria-label="Reset view">⌂</button>
          </div>
          <div className="scalebar glass">
            {scale.km ? `${scale.km.toLocaleString()} km` : '—'}
            <div className="scalebar__bar" style={{ width: `${Math.round(scale.px)}px` }} />
          </div>
        </div>

        {hovered && tip && (
          <div className="tip glass" style={{ left: tip.x, top: tip.y }}>
            <span>{hovered.country.emoji}</span>
            <span>{hovered.country.name}</span>
          </div>
        )}

        {(comparing || armingCompare) && (
          <div className="compare-hud glass">
            <p>
              {armingCompare ? (
                'Click any country to lift its outline off the map.'
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
            <button type="button" className="action" onClick={toggleCompare}>
              {armingCompare ? 'Cancel' : 'Put it back'}
            </button>
          </div>
        )}

        {error && (
          <div className="compare-hud glass">
            <p>The map data failed to load ({error}). Reloading usually fixes it.</p>
          </div>
        )}
      </main>

      <aside className="panel">
        <Outlet />
      </aside>
    </div>
  );
}

function ratio(a: number, b: number): string {
  const r = a / b;
  return r >= 1 ? `${r.toFixed(1)}× larger` : `${(1 / r).toFixed(1)}× smaller`;
}
