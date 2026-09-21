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

import { LayersIcon, LayersSheet, ProgressSheet, SheetGrip, TabBar, type OverlayName } from '~/components/MobileChrome';
import { Rail } from '~/components/Rail';
import { SearchBox } from '~/components/SearchBox';
import { ProgressProvider, useProgress } from '~/lib/core/ProgressProvider';
import { Atlas } from '~/lib/map/atlas';
import { COARSE_QUERY, isPhoneLayout, PHONE_QUERY, useMediaQuery } from '~/lib/viewport';
import { sheetVisible, stepSnap, useSheetDrag, type SheetSnap } from '~/lib/sheet';
import { NO_INSETS, type Insets } from '~/lib/map/camera';
import type { CountryRecord, Feature, PlaceMark, World } from '~/lib/map/types';
import { loadWorld, onFullDetail } from '~/lib/geography/world';
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
  /** Phone layout only (no effect on desktop): a quiz run takes the whole screen — no sheet,
   *  no tab bar, no search — until its results, which open the sheet at `full`. */
  setImmersive: Dispatch<SetStateAction<boolean>>;
  setSheetSnap: Dispatch<SetStateAction<SheetSnap>>;
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
  const [showCapitals, setShowCapitals] = useState(true);
  const [hovered, setHovered] = useState<Feature | null>(null);
  const [hoveredPlace, setHoveredPlace] = useState<PlaceMark | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState({ km: 0, px: 0 });
  const [comparing, setComparing] = useState<{ feature: Feature; over: Feature | null } | null>(null);
  const [armingCompare, setArmingCompare] = useState(false);
  const [atlasInstance, setAtlasInstance] = useState<Atlas | null>(null);
  const [quiz, setQuiz] = useState<QuizOverride | null>(null);

  /* phone layout: where the bottom sheet rests, what covers the map, and which overlay
     sheet (Layers / Progress) is open. Meaningless — and never rendered — on desktop. */
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const [immersive, setImmersive] = useState(false);
  const [overlaySheet, setOverlaySheet] = useState<OverlayName>(null);
  const panelRef = useRef<HTMLElement>(null);
  const phone = useMediaQuery(PHONE_QUERY);
  const coarse = useMediaQuery(COARSE_QUERY);
  useSheetDrag(panelRef, { snap, onSnap: setSnap, enabled: phone && !immersive });

  /* What the sheet and tab bar cover, for the camera — read through refs so an effect that
     fires in the same commit as a snap change (a cold load flying to its country) sees the
     snap it is about to have, not the last render's. */
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const immersiveRef = useRef(immersive);
  immersiveRef.current = immersive;
  const applyInsets = useCallback((atlas: Atlas) => {
    // Desktop: the panel is a grid column beside the map, so nothing covers the canvas.
    // A quiz run on a phone sets its own insets (HUD above, input below) — not this.
    if (!isPhoneLayout()) return atlas.setInsets(NO_INSETS);
    if (immersiveRef.current) return;
    const vh = window.innerHeight;
    const tab = document.querySelector<HTMLElement>('.tabbar')?.offsetHeight ?? 0;
    const top = document.querySelector<HTMLElement>('.hud--top')?.getBoundingClientRect().bottom ?? 0;
    // A full sheet leaves a strip too thin to frame anything in, and whoever is reading the
    // dossier is not looking at the map: frame as if it were at half.
    const covered = Math.min(sheetVisible(snapRef.current, vh, tab), vh * 0.5);
    const insets: Insets = { top: top ? top + 8 : 0, right: 0, bottom: covered, left: 0 };
    atlas.setInsets(insets);
  }, []);
  useEffect(() => {
    if (atlasInstance) applyInsets(atlasInstance);
  }, [atlasInstance, applyInsets, snap, immersive, phone]);

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
      // (leaving /quiz/:quizId tears the quiz override down) and lose all progress and
      // the timer, with no confirmation. The quiz has its own input for interaction.
      if (quiz) return;
      if (armingCompare) {
        if (feature && atlasRef.current?.startCompare(feature)) {
          setArmingCompare(false);
          setComparing({ feature, over: null });
        }
        return;
      }
      // `sheet: 'peek'` (phone layout only): the map stays visible behind a selection
      navigate(feature ? `/country/${feature.country.slug}` : '/', { state: { sheet: 'peek' } });
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
        onHover: (feature, x, y, place) => {
          setHovered(feature);
          setHoveredPlace(place ?? null);
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
        showPins: true,
        showCapitals: true
      }
    );
    atlas.setUiFont(
      getComputedStyle(document.body).getPropertyValue('--font-ui') || 'system-ui, sans-serif'
    );
    atlasRef.current = atlas;
    applyInsets(atlas);
    if (isPhoneLayout()) atlas.home(false); // reframe now that it knows what covers it
    setAtlasInstance(atlas);
    // The map has been painting from coarse geometry since `world` first resolved (see
    // loadWorld) — repaint once the full 1:10m payload attaches in place, so a country
    // already on screen sharpens up without waiting for the next pan or zoom.
    onFullDetail(() => atlas.redraw());
    return () => {
      atlas.destroy();
      atlasRef.current = null;
      setAtlasInstance(null);
    };
  }, [world, applyInsets]);

  /* restyle whenever anything visual changes — quiz mode takes over the whole style
     rather than folding into fillFor/strokeFor, since none of the normal overlay/
     selection/mastery logic applies mid-quiz (see quizFillFor's own doc comment) */
  useEffect(() => {
    // the capitals quiz's target ring — the target country's own place, or nothing
    const quizPlace =
      quiz?.showCapital && quiz.target
        ? world?.places.find(mark => mark.feature === quiz.target) ?? null
        : null;
    atlasRef.current?.setStyle(
      quiz
        ? {
            fill: f => quizFillFor(f, quiz),
            stroke: f => quizStrokeFor(f, quiz),
            showLabels: true,
            showPins,
            showCapitals: false,
            quizPlace,
            quizMode: true
          }
        : {
            fill: f => fillFor(f, styleRef.current),
            stroke: f => strokeFor(f, styleRef.current),
            showLabels: true,
            showPins,
            showCapitals,
            quizMode: false
          }
    );
  }, [styleInputs, showPins, showCapitals, quiz, world]);

  /**
   * Where the phone sheet rests after a navigation. Links and navigate() say so with
   * `state.sheet` (a map tap or a search pick: peek; a tab: half); a link that says nothing —
   * a neighbour chip inside the sheet — leaves it where the reader had it. A cold load has no
   * state: home rests at peek, every other page (a shared country link, /quiz) opens at half,
   * because the page is the reason they came.
   */
  const firstNavigationRef = useRef(true);
  useEffect(() => {
    const first = firstNavigationRef.current;
    firstNavigationRef.current = false;
    if (!isPhoneLayout()) return;
    const asked =
      (location.state as { sheet?: SheetSnap } | null)?.sheet ??
      (first && location.pathname !== '/' ? 'half' : undefined);
    if (!asked) return;
    snapRef.current = asked; // the fly effect below runs in this same flush
    setSnap(asked);
  }, [location.key, location.pathname, location.state]);

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
    if (cold || (location.state as { fly?: boolean } | null)?.fly === true) {
      applyInsets(atlas); // frame in what the sheet leaves visible, at the snap it is about to have
      atlas.flyTo(selected);
    }
  }, [selected, location.state, applyInsets]);

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
    <AtlasContext.Provider value={{ atlas: atlasInstance, quiz, setQuiz, setImmersive, setSheetSnap: setSnap }}>
    <div className={`shell${immersive ? ' is-immersive' : ''}${quiz ? ' is-quiz' : ''}`}>
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
                navigate(`/country/${feature.country.slug}`, { state: { fly: true, sheet: 'peek' } })
              }
            />
            <button
              type="button"
              className="layers-btn"
              aria-label="Layers"
              aria-expanded={overlaySheet === 'layers'}
              onClick={() => setOverlaySheet(o => (o === 'layers' ? null : 'layers'))}
            >
              <LayersIcon />
            </button>
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
              <button
                type="button"
                className="tool"
                aria-pressed={showCapitals}
                onClick={() => setShowCapitals(v => !v)}
              >
                Capitals
              </button>
            </div>
          </div>
        )}

        <div className="hud hud--bottom">
          <div className="zoomer glass">
            <button type="button" className="zoom-step" onClick={() => atlasRef.current?.zoomBy(1.7)} aria-label="Zoom in">+</button>
            <button type="button" className="zoom-step" onClick={() => atlasRef.current?.zoomBy(1 / 1.7)} aria-label="Zoom out">−</button>
            <button type="button" onClick={() => {
              // during a run ⌂ is only a camera reset: navigating to '/' would unmount the
              // quiz route and silently abandon the run (the same trap as a map click)
              if (!quiz) navigate('/');
              atlasRef.current?.home();
            }} aria-label="Reset view">⌂</button>
          </div>
          <div className="scalebar glass">
            {scale.km ? `${scale.km.toLocaleString()} km` : '—'}
            <div className="scalebar__bar" style={{ width: `${Math.round(scale.px)}px` }} />
          </div>
        </div>

        {!quiz && hovered && tip && !coarse && (
          <div className="tip glass" style={{ left: tip.x, top: tip.y }}>
            <span>{hovered.country.emoji}</span>
            <span>{hoveredPlace ? hoveredPlace.place.name : hovered.country.name}</span>
          </div>
        )}

        {(comparing || armingCompare) && (
          <div className="compare-hud glass">
            <p>
              {armingCompare ? (
                <>
                  <span className="only-fine">Click</span>
                  <span className="only-coarse">Tap</span> any country to lift its outline off the map.
                </>
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

      <aside
        className="panel"
        ref={panelRef}
        data-snap={snap}
        data-hidden={immersive}
        aria-hidden={phone && immersive ? true : undefined}
      >
        <SheetGrip snap={snap} onStep={() => setSnap(stepSnap(snap))} />
        <Outlet />
      </aside>

      <TabBar overlay={overlaySheet} onOverlay={setOverlaySheet} />
      <LayersSheet
        open={overlaySheet === 'layers'}
        onClose={() => setOverlaySheet(null)}
        overlay={overlay}
        onOverlayChange={setOverlay}
        showNeighbours={showNeighbours}
        onNeighbours={() => setShowNeighbours(v => !v)}
        showPins={showPins}
        onPins={() => setShowPins(v => !v)}
        showCapitals={showCapitals}
        onCapitals={() => setShowCapitals(v => !v)}
        comparing={Boolean(comparing) || armingCompare}
        onCompare={toggleCompare}
      />
      <ProgressSheet open={overlaySheet === 'progress'} onClose={() => setOverlaySheet(null)} totals={totals} />
    </div>
    </AtlasContext.Provider>
  );
}

function ratio(a: number, b: number): string {
  const r = a / b;
  return r >= 1 ? `${r.toFixed(1)}× larger` : `${(1 / r).toFixed(1)}× smaller`;
}
