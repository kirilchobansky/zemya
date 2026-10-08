/**
 * The map side of the atlas shell: loads the world, creates the MapLibre controller once it
 * arrives, and keeps it in step — style (overlay, selection, mastery, quiz mode), selection
 * from the URL, the camera (fly only when the user could not already see the target), hover,
 * and the size-comparison tool.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHoverTip } from './use-hover-tip';
import { useLocation, useNavigation } from 'react-router';

import {
  countryMastery, defaultStrokeFor, fillFor, loadWorld, masteryTotals, quizFillFor, quizStrokeFor,
  refreshOverlayColours, strokeFor, type OverlayId, type QuizOverride
} from '~/features/countries';
import { useProgress } from '~/features/progress';
import type { MapController } from '~/engines/map/controller';
import { loadMapEngine } from '~/engines/map/engine';
import { toFailure, type LoadFailure } from '~/engines/map/load-error';
import type { RetryInfo } from '~/engines/map/retry';
import { refreshMapColours, type MicroMode } from '~/engines/map/style';
import type { CountryRecord, Feature, PlaceMark, World } from '~/engines/map/types';
import { isPhoneLandscape, isPhoneLayout } from '~/shared/layout/viewport';
import { useGo } from '~/shared/lib/navigation';
import { reloadOnce } from '~/shared/lib/stale-deploy';
import { onThemeChange } from '~/shared/lib/theme';

const COUNTRY_PATH = /^\/country\/([^/]+)\/?$/;

export function useMapController({ overlay, showNeighbours, micro, showNames, showCapitals, quiz, applyInsets }: {
  overlay: OverlayId;
  showNeighbours: boolean;
  micro: MicroMode;
  showNames: boolean;
  showCapitals: boolean;
  quiz: QuizOverride | null;
  applyInsets: (atlas: MapController) => void;
}) {
  /** The map's host element: MapLibre fills it with its own canvas. */
  const mapHostRef = useRef<HTMLDivElement>(null);
  const atlasRef = useRef<MapController | null>(null);
  const go = useGo();
  const location = useLocation();
  const navigation = useNavigation();
  const { cards } = useProgress();

  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState<LoadFailure | null>(null);
  /** A step failed and is being tried again (cleared when the map is up or it gives up). */
  const [retrying, setRetrying] = useState<RetryInfo | null>(null);
  /** The GPU context was lost and MapLibre is rebuilding the map. */
  const [restoring, setRestoring] = useState(false);
  /** Bumped by Retry: re-runs the whole load without a page reload. */
  const [reloadKey, setReloadKey] = useState(0);
  const [hovered, setHovered] = useState<Feature | null>(null);
  const [hoveredPlace, setHoveredPlace] = useState<PlaceMark | null>(null);
  const { tip, tipRef, setTip, movePointer } = useHoverTip();
  const [scale, setScale] = useState({ km: 0, px: 0 });
  const [comparing, setComparing] = useState<{ feature: Feature; over: Feature | null } | null>(null);
  const [armingCompare, setArmingCompare] = useState(false);
  const [atlasInstance, setAtlasInstance] = useState<MapController | null>(null);

  // The selection follows the navigation the moment it starts, not when its data has loaded: the
  // highlight must land on the tap itself. (The clientLoaders answer from memory, so pending is
  // brief; this covers the fallback to the network.)
  const slug = COUNTRY_PATH.exec(navigation.location?.pathname ?? location.pathname)?.[1] ?? null;
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
    loadWorld(info => { if (!cancelled) setRetrying(info); }).then(
      w => { if (!cancelled) { setRetrying(null); setWorld(w); } },
      e => { if (!cancelled) { setRetrying(null); setError(toFailure('data', e)); } }
    );
    return () => { cancelled = true; };
  }, [reloadKey]);

  const retry = useCallback(() => {
    setError(null);
    setRetrying(null);
    setRestoring(false);
    setReloadKey(k => k + 1);
  }, []);

  const handleSelect = useCallback(
    (feature: Feature | null) => {
      // never navigate mid-run (it would lose the run); only a finished run's onInspect does
      if (quiz) return void (feature && quiz.onInspect?.(feature));
      if (armingCompare) {
        if (feature && atlasRef.current?.startCompare(feature)) {
          setArmingCompare(false);
          setComparing({ feature, over: null });
        }
        return;
      }
      // `sheet: 'peek'` (phone layout only): the map stays visible behind a selection
      go(feature ? `/country/${feature.country.slug}` : '/', { state: { sheet: isPhoneLandscape() ? 'half' : 'peek' } });
    },
    [armingCompare, go, quiz]
  );

  /* keep the latest callbacks reachable without rebuilding the controller */
  const handleSelectRef = useRef(handleSelect);
  handleSelectRef.current = handleSelect;
  const styleRef = useRef(styleInputs);
  styleRef.current = styleInputs;

  /* create the controller once the payload has arrived. The engine (and, for 'gl', MapLibre) is
     imported on demand here, so neither is in the first page load. */
  useEffect(() => {
    if (!world || !mapHostRef.current || atlasRef.current) return;
    const host = mapHostRef.current;
    let cancelled = false;
    let created: MapController | null = null;
    // Colours are resolved from CSS once, here and on a theme change — never per frame
    // (CLAUDE.md's Visual identity note) — and must be fresh before the first frame is drawn.
    refreshOverlayColours();
    refreshMapColours();
    const hooks = { onRetry: (info: RetryInfo) => setRetrying(info), cancelled: () => cancelled };
    loadMapEngine(hooks)
      .then(engine => {
        if (cancelled) return null;
        return engine.create(
          host,
          world,
          {
            onHover: (feature, x, y, place) => {
              setHovered(feature);
              setHoveredPlace(place ?? null);
              setTip(feature ? { x, y } : null);
            },
            onPointer: movePointer, // the tooltip follows the mouse
            onSelect: f => handleSelectRef.current(f),
            onCameraChange: setScale,
            onCompareMove: (feature, over) => setComparing({ feature, over }),
            onStatus: status => {
              if (status.kind === 'failed') setError(status.failure);
              setRestoring(status.kind === 'restoring');
            }
          },
          {
            fill: f => fillFor(f, styleRef.current),
            stroke: f => strokeFor(f, styleRef.current),
            defaultStroke: defaultStrokeFor,
            showLabels: true,
            showPins: true,
            showCapitals: true
          },
          hooks
        );
      })
      .then(atlas => {
        if (!atlas) return;
        if (cancelled) return atlas.destroy();
        created = atlas;
        atlas.setUiFont(getComputedStyle(document.body).getPropertyValue('--font-ui') || 'system-ui, sans-serif');
        atlasRef.current = atlas;
        applyInsets(atlas);
        if (isPhoneLayout()) atlas.home(false); // reframe now that it knows what covers it
        setRetrying(null);
        setAtlasInstance(atlas);
      })
      .catch(e => {
        if (cancelled) return;
        const failure = toFailure('map', e);
        setRetrying(null);
        setError(failure);
        // a chunk that will not load after retries is most likely a deploy newer than this page
        if (failure.step === 'chunk') reloadOnce();
      });
    return () => {
      cancelled = true;
      if (created) {
        created.destroy();
        atlasRef.current = null;
        setAtlasInstance(null);
      }
    };
  }, [world, applyInsets, reloadKey]);

  /* a theme switch must repaint the canvas — its colours are a getComputedStyle cache
     (renderer.ts's COLORS, overlays.ts's exported palette), not a live CSS lookup */
  useEffect(() => onThemeChange(() => {
    refreshOverlayColours();
    refreshMapColours();
    atlasRef.current?.redraw();
  }), []);

  // entering or leaving a quiz run starts with no hover, so no stale country is kept
  const inQuiz = quiz !== null;
  useEffect(() => {
    atlasRef.current?.clearHover();
    setHovered(null);
    setHoveredPlace(null);
    setTip(null);
  }, [inQuiz, atlasInstance]);

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
            defaultStroke: defaultStrokeFor,
            showLabels: true,
            showPins: true,
            micro: 'full', // a quiz target must never be hidden by the player's Micro choice
            showCapitals: false,
            quizPlace,
            quizMode: true,
            quizNames: Boolean(quiz.onInspect)
          }
        : {
            fill: f => fillFor(f, styleRef.current),
            stroke: f => strokeFor(f, styleRef.current),
            defaultStroke: defaultStrokeFor,
            showLabels: showNames,
            showPins: micro !== 'off',
            micro,
            showCapitals,
            quizMode: false
          }
    );
  }, [styleInputs, micro, showNames, showCapitals, quiz, world, atlasInstance]);

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
  }, [selected, location.state, applyInsets, atlasInstance]);

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

  return {
    world, error, retrying, restoring, retry, mapHostRef, atlasRef, atlasInstance, hovered, hoveredPlace, tip, tipRef, scale,
    comparing, armingCompare, selected, totals, toggleCompare
  };
}
