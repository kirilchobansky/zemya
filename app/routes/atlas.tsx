/**
 * The atlas shell. Owns the canvas, the camera and every piece of map state; the child
 * routes render only the right-hand panel. Selection lives in the URL, so a country page
 * can be linked to directly; whether a selection *also* moves the camera is carried in the
 * navigation's state rather than inferred from the selection itself.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type Dispatch, type SetStateAction
} from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { Rail } from '~/components/Rail';
import { SearchBox } from '~/components/SearchBox';
import { ProgressProvider, useProgress } from '~/lib/core/ProgressProvider';
import { Atlas } from '~/lib/map/atlas';
import type { CountryRecord, Feature, World } from '~/lib/map/types';
import { loadWorld } from '~/lib/geography/world';
import { countryMastery, masteryTotals } from '~/lib/geography/mastery';
import {
  fillFor, quizFillFor, quizStrokeFor, strokeFor, type OverlayId, type QuizOverride
} from '~/lib/geography/overlays';

const COUNTRY_PATH = /^\/country\/([^/]+)\/?$/;

/**
 * The layout owns the canvas, so a quiz run — a child route rendered only into the right
 * panel — reaches the Atlas controller (to fly the camera) and the map's style (to paint
 * answered countries) through this context rather than through props. `quiz` is the
 * single flag CLAUDE.md's Quizzes section asks for: setting it swaps the map into quiz
 * mode (see the style effect below) and, at the JSX call sites in this file, hides the
 * search box and the hover tooltip and turns off the default neighbour glow — one state,
 * checked in the few places that need it, rather than four independent booleans.
 */
interface AtlasContextValue {
  atlas: Atlas | null;
  quiz: QuizOverride | null;
  setQuiz: Dispatch<SetStateAction<QuizOverride | null>>;
}

const AtlasContext = createContext<AtlasContextValue | null>(null);

export function useAtlasContext(): AtlasContextValue {
  const value = useContext(AtlasContext);
  if (!value) throw new Error('useAtlasContext must be used inside the atlas layout');
  return value;
}

/**
 * The provider wraps the shell rather than the app root because progress is only ever read
 * inside the atlas — the panel routes render as its children, so one provider covers the
 * map, the rail and the dossier.
 */
export default function AtlasLayout() {
  return (
    <ProgressProvider>
      <AtlasShell />
    </ProgressProvider>
  );
}

function AtlasShell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const atlasRef = useRef<Atlas | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { cards } = useProgress();

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
  const [atlasInstance, setAtlasInstance] = useState<Atlas | null>(null);
  const [quiz, setQuiz] = useState<QuizOverride | null>(null);

  const slug = COUNTRY_PATH.exec(location.pathname)?.[1] ?? null;
  const selected = slug && world ? world.bySlug.get(slug) ?? null : null;

  /**
   * The slug the document was loaded with, if any. A cold load of /country/chile must fly:
   * the visitor arrived already pointed at a country and has never seen the map. It is the
   * only selection allowed to fly without an explicit flag, so the ref is spent the first
   * time a selection resolves.
   */
  const coldSlugRef = useRef(slug);

  /**
   * Mastery is derived on demand rather than stored, so this closure is what the renderer
   * and the rail both read through. It changes identity whenever a card changes, which is
   * what drives the restyle below — grading a facet recolours the map in the same tick.
   */
  const masteryOf = useCallback(
    (country: CountryRecord) => countryMastery(country, cards),
    [cards]
  );

  const totals = useMemo(
    () => masteryTotals(world ? world.features.map(f => f.country) : [], cards),
    [world, cards]
  );

  /* the style callbacks the renderer calls per country, per frame */
  const styleInputs = useMemo(
    () => ({ overlay, selected, hovered, showNeighbours, masteryOf }),
    [overlay, selected, hovered, showNeighbours, masteryOf]
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
      // A map click during a quiz run must never navigate — it would unmount the run
      // (leaving /quiz/countries tears the quiz override down) and lose all progress and
      // the timer, with no confirmation. The quiz has its own input for interaction.
      if (quiz) return;
      if (armingCompare) {
        if (feature && atlasRef.current?.startCompare(feature)) {
          setArmingCompare(false);
          setComparing({ feature, over: null });
        }
        return;
      }
      navigate(feature ? `/country/${feature.country.slug}` : '/');
    },
    [armingCompare, navigate, quiz]
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
    setAtlasInstance(atlas);
    return () => {
      atlas.destroy();
      atlasRef.current = null;
      setAtlasInstance(null);
    };
  }, [world]);

  /* restyle whenever anything visual changes — quiz mode takes over the whole style
     rather than folding into fillFor/strokeFor, since none of the normal overlay/
     selection/mastery logic applies mid-quiz (see quizFillFor's own doc comment) */
  useEffect(() => {
    atlasRef.current?.setStyle(
      quiz
        ? {
            fill: f => quizFillFor(f, quiz),
            stroke: f => quizStrokeFor(f, quiz),
            showLabels: true,
            showPins,
            quizMode: true
          }
        : {
            fill: f => fillFor(f, styleRef.current),
            stroke: f => strokeFor(f, styleRef.current),
            showLabels: true,
            showPins,
            quizMode: false
          }
    );
  }, [styleInputs, showPins, quiz]);

  /**
   * Move the camera only when the user could not already have seen the target. A map click
   * navigates without state, so it never flies — the country was on screen and under the
   * cursor, and moving the map out from under it destroys the sense of place. Search, the
   * panel links and a cold URL all set `fly`. Deselecting never moves the camera; only the
   * ⌂ button returns to the world view. See "Interaction principles" in CLAUDE.md.
   */
  useEffect(() => {
    const atlas = atlasRef.current;
    if (!atlas || !selected) return;
    const cold = coldSlugRef.current === selected.country.slug;
    coldSlugRef.current = null;
    if (cold || (location.state as { fly?: boolean } | null)?.fly === true) atlas.flyTo(selected);
  }, [selected, location.state]);

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
    armingCompare ? 'is-picking' : '',
    quiz?.paused ? 'is-quiz-paused' : ''
  ].filter(Boolean).join(' ');

  return (
    <AtlasContext.Provider value={{ atlas: atlasInstance, quiz, setQuiz }}>
    <div className="shell">
      <Rail
        overlay={overlay}
        onOverlayChange={setOverlay}
        countryCount={world?.features.length ?? 0}
        totals={totals}
      />

      <main className="stage">
        <canvas ref={canvasRef} className={canvasClass} aria-label="World map" />

        {!quiz && (
          <div className="hud hud--top">
            <SearchBox
              world={world}
              onPick={feature =>
                navigate(`/country/${feature.country.slug}`, { state: { fly: true } })
              }
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
        )}

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

        {!quiz && hovered && tip && (
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
    </AtlasContext.Provider>
  );
}

function ratio(a: number, b: number): string {
  const r = a / b;
  return r >= 1 ? `${r.toFixed(1)}× larger` : `${(1 / r).toFixed(1)}× smaller`;
}
