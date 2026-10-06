/**
 * The atlas shell. Owns the canvas, the camera and every piece of map state; the child
 * routes render only the right-hand panel. Selection lives in the URL, so a country page
 * can be linked to directly; whether a selection *also* moves the camera is carried in the
 * navigation's state rather than inferred from the selection itself.
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent
} from 'react';
import { Outlet, useLocation, useNavigate, useNavigation } from 'react-router';

import { LayersIcon, LayersSheet, ProgressSheet, SheetGrip, TabBar, type OverlayName, EdgeArrow, Rail, UpButton, AtlasContext, type TimelineLabels } from '~/features/map';
import { SearchBox, loadWorld, countryMastery, masteryTotals, defaultStrokeFor, fillFor, quizFillFor, quizStrokeFor, refreshOverlayColours, strokeFor, type OverlayId, type QuizOverride, type StyleInputs } from '~/features/countries';
import { ProgressProvider, useProgress } from '~/features/progress';
import type { MapController } from '~/engines/map/controller';
import { loadMapEngine } from '~/engines/map/engine';
import { refreshMapColours, type MicroMode } from '~/engines/map/style';
import { HistoryCard, PinnedHistoryCard, HistoryTimeline, type HistoryHover } from '~/features/history';
import type { TimelineEntry, EntryKind } from '~/features/history';
import { COARSE_QUERY, isPhoneLandscape, isPhoneLayout, LANDSCAPE_QUERY, PHONE_QUERY, useMediaQuery } from '~/shared/layout/viewport';
import { sheetVisible, stepSnap, useSheetDrag, type SheetSnap } from '~/shared/layout/sheet';
import { NO_INSETS, type Insets } from '~/engines/map/camera';
import type { CountryRecord, Feature, PlaceMark, World } from '~/engines/map/types';
import { onThemeChange } from '~/shared/lib/theme';

/** The Micro toggle's cycle, and what its button says. */
const MICRO_CYCLE: readonly MicroMode[] = ['full', 'dots', 'off'];
const MICRO_LABEL: Record<MicroMode, string> = { full: 'Full', dots: 'Dots', off: 'Off' };
const nextMicro = (current: MicroMode): MicroMode => MICRO_CYCLE[(MICRO_CYCLE.indexOf(current) + 1) % MICRO_CYCLE.length];

/** Routes whose phone sheet has no half snap (the History timeline keeps peek / half / full). */
const TWO_STOP_PATH = /^\/(quizzes|questions)(\/|$)/;
const COUNTRY_PATH = /^\/country\/([^/]+)\/?$/;

/* ------------------------------------------------------------------- sidebar resize/collapse
   Desktop layout only — the left rail and the right panel each get a drag handle (resize),
   a collapse button (hide to width 0, an edge tab brings it back) and a double-click-to-
   reset on the handle. Width and collapsed state persist in localStorage per sidebar, kept
   deliberately simple (one JSON blob per side) rather than a shared hook file, since this
   is the only place either sidebar is rendered. */

const RAIL_MIN_PX = 180;
const RAIL_MAX_PX = 320;
const PANEL_MIN_PX = 300;
const PANEL_MAX_PX = 560;
/** Below this viewport width, a sidebar with no stored width yet opens narrower — applied
 *  post-mount only (the useLayoutEffect below), never during the first render, since
 *  window.innerWidth isn't available (or wouldn't match) during the server's prerender. */
const NARROW_VIEWPORT_PX = 1440;
const RAIL_DEFAULT_WIDE_PX = 286;
const RAIL_DEFAULT_NARROW_PX = 238;
const PANEL_DEFAULT_WIDE_PX = 372;
const PANEL_DEFAULT_NARROW_PX = 330;

function clampPx(px: number, min: number, max: number): number {
  return Math.min(Math.max(px, min), max);
}

function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < NARROW_VIEWPORT_PX;
}

function defaultRailWidth(): number {
  return isNarrowViewport() ? RAIL_DEFAULT_NARROW_PX : RAIL_DEFAULT_WIDE_PX;
}

function defaultPanelWidth(): number {
  return isNarrowViewport() ? PANEL_DEFAULT_NARROW_PX : PANEL_DEFAULT_WIDE_PX;
}

interface SidebarPersisted {
  width: number;
  collapsed: boolean;
}

/** Reads one sidebar's persisted {width, collapsed} — wrapped in try/catch (localStorage
 *  can throw in a private window or with site data blocked) and sanity-checked against the
 *  given bounds, so a value from an older build with different min/max can't wedge the
 *  layout. */
function loadSidebar(key: string, fallbackWidth: number, min: number, max: number): SidebarPersisted {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { width: fallbackWidth, collapsed: false };
    const parsed = JSON.parse(raw) as Partial<SidebarPersisted>;
    const width = typeof parsed.width === 'number' && Number.isFinite(parsed.width) ? clampPx(parsed.width, min, max) : fallbackWidth;
    return { width, collapsed: parsed.collapsed === true };
  } catch {
    return { width: fallbackWidth, collapsed: false };
  }
}

function saveSidebar(key: string, value: SidebarPersisted): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage unavailable (private window, blocked site data, ...) — the sidebar just
    // reopens at its default next time, same as CLAUDE.md asks for every localStorage use.
  }
}

const RAIL_STORAGE_KEY = 'zemya.sidebar.rail';
const PANEL_STORAGE_KEY = 'zemya.sidebar.panel';

/** Which sidebar a drag/keyboard/double-click action targets — the two share this module's
 *  handling almost entirely, only their min/max/default/storage differ. */
type SidebarSide = 'rail' | 'panel';

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
  /** The map's host element: MapLibre fills it with its own canvas. */
  const mapHostRef = useRef<HTMLDivElement>(null);
  const atlasRef = useRef<MapController | null>(null);
  const historyCanvasRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HistoryTimeline | null>(null);
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[] | null>(null);
  const [timelineLabels, setTimelineLabels] = useState<TimelineLabels>({ pastLabel: '', futureLabel: '' });
  const [historyHover, setHistoryHover] = useState<HistoryHover | null>(null);
  /** Non-null only while a history route (routes/history/history.$slug.tsx) has handed its
   *  entries over — the canvas shows the map the rest of the time, including on the bare
   *  /history picker. */
  const showTimeline = timelineEntries !== null;

  /** Pinned timeline cards (click-to-pin — see HistoryTimeline's onEntryClick below), in
   *  pin order: appended on a new pin, never reordered by bring-to-front (`z` alone drives
   *  stacking), so array order is what "close the oldest" (max 8) reads off. */
  const [pinnedCards, setPinnedCards] = useState<
    { id: string; entry: TimelineEntry; rect: HistoryHover['rect']; z: number }[]
  >([]);
  const [selectedHistoryEntryId, setSelectedHistoryEntryId] = useState<string | null>(null);
  const [historyTimelineInstance, setHistoryTimelineInstance] = useState<HistoryTimeline | null>(null);
  const [historyCurrentPeriodId, setHistoryCurrentPeriodId] = useState<string | null>(null);
  const [historyHiddenKinds, setHistoryHiddenKinds] = useState<ReadonlySet<EntryKind>>(() => new Set());
  const [historyHiddenCategories, setHistoryHiddenCategories] = useState<ReadonlySet<string>>(() => new Set());
  /** Every pinned card's own current DOM rect, mutated straight from HistoryCard.tsx's
   *  onRectChange (mount + every drag frame) and forwarded to HistoryTimeline directly —
   *  a ref, not React state, so a drag doesn't re-render this whole shell every frame. */
  const pinnedRectsRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());
  const pinZRef = useRef(0);
  const MAX_PINNED_CARDS = 8;

  const handleEntryClick = useCallback((hit: HistoryHover) => {
    setPinnedCards(prev => {
      const z = ++pinZRef.current;
      const existing = prev.find(p => p.id === hit.entry.id);
      if (existing) return prev.map(p => (p.id === hit.entry.id ? { ...p, z } : p));
      const next = [...prev, { id: hit.entry.id, entry: hit.entry, rect: hit.rect, z }];
      return next.length > MAX_PINNED_CARDS ? next.slice(1) : next;
    });
  }, []);
  /** Pins an entry that isn't necessarily on screen (the detail view's "Pin card" button,
   *  app/features/history/components/HistoryDetail.tsx — it has no canvas rect of its own to seed the card's
   *  position from) — same mechanism as handleEntryClick, centred on the canvas instead of
   *  at a click point. */
  const pinHistoryEntry = useCallback((entry: TimelineEntry) => {
    const canvas = historyCanvasRef.current;
    const rect = { x: (canvas?.clientWidth ?? 0) / 2, y: (canvas?.clientHeight ?? 0) / 2, w: 0, h: 0 };
    handleEntryClick({ entry, rect });
  }, [handleEntryClick]);
  const handleCardFront = useCallback((id: string) => {
    setPinnedCards(prev => prev.map(p => (p.id === id ? { ...p, z: ++pinZRef.current } : p)));
  }, []);
  const handleCardRectChange = useCallback((id: string, rect: { x: number; y: number; w: number; h: number }) => {
    pinnedRectsRef.current.set(id, rect);
    timelineRef.current?.setPinnedCardRects(pinnedRectsRef.current);
  }, []);
  const handleCardClose = useCallback((id: string) => {
    setPinnedCards(prev => prev.filter(p => p.id !== id));
    setSelectedHistoryEntryId(sel => (sel === id ? null : sel));
    pinnedRectsRef.current.delete(id);
    timelineRef.current?.setPinnedCardRects(pinnedRectsRef.current);
  }, []);
  const closeAllHistoryCards = useCallback(() => {
    setPinnedCards([]);
    setSelectedHistoryEntryId(null);
    pinnedRectsRef.current.clear();
    timelineRef.current?.setPinnedCardRects(pinnedRectsRef.current);
  }, []);

  const toggleHistoryKind = useCallback((kind: EntryKind) => {
    setHistoryHiddenKinds(prev => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);
  const toggleHistoryCategory = useCallback((category: string) => {
    setHistoryHiddenCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);
  const resetHistoryFilters = useCallback(() => {
    setHistoryHiddenKinds(new Set());
    setHistoryHiddenCategories(new Set());
  }, []);

  // Leaving the history route (showTimeline going false) clears every pinned card, any open
  // detail view and every filter — "pinned cards are cleared when leaving the history
  // route" / "the [filter] state ... resets when leaving the history route."
  useEffect(() => {
    if (!showTimeline) {
      setPinnedCards([]);
      setSelectedHistoryEntryId(null);
      setHistoryHiddenKinds(new Set());
      setHistoryHiddenCategories(new Set());
      pinnedRectsRef.current.clear();
    }
  }, [showTimeline]);

  // Pushes HistoryFilters.tsx's own state down to the canvas controller whenever it
  // changes (including once the controller itself first mounts, via the timelineEntries dep).
  useEffect(() => {
    timelineRef.current?.setFilters(historyHiddenKinds, historyHiddenCategories);
  }, [historyHiddenKinds, historyHiddenCategories, timelineEntries]);

  // Esc closes the front-most pinned card (highest z) — global, since a card's own body
  // isn't necessarily focused.
  useEffect(() => {
    if (!showTimeline) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPinnedCards(prev => {
        if (!prev.length) return prev;
        const front = prev.reduce((a, b) => (b.z > a.z ? b : a));
        setSelectedHistoryEntryId(sel => (sel === front.id ? null : sel));
        return prev.filter(p => p.id !== front.id);
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showTimeline]);
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigation();
  const { cards } = useProgress();

  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<OverlayId>('terrain');
  const [showNeighbours, setShowNeighbours] = useState(true);
  const [micro, setMicro] = useState<MicroMode>('full');
  const [showNames, setShowNames] = useState(true);
  const [showCapitals, setShowCapitals] = useState(true);
  const [hovered, setHovered] = useState<Feature | null>(null);
  const [hoveredPlace, setHoveredPlace] = useState<PlaceMark | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState({ km: 0, px: 0 });
  const [comparing, setComparing] = useState<{ feature: Feature; over: Feature | null } | null>(null);
  const [armingCompare, setArmingCompare] = useState(false);
  const [atlasInstance, setAtlasInstance] = useState<MapController | null>(null);
  const [quiz, setQuiz] = useState<QuizOverride | null>(null);

  /* ---------------------------------------------------------------- sidebar resize/collapse
     Desktop only (see the module-level comment above). The very first render — server AND
     client — must produce the same `.shell` markup, so it always starts from the same fixed
     constants; reading localStorage or window.innerWidth here (both browser-only, both
     absent or different during the server's prerender) would make the client's first render
     disagree with the prerendered HTML it's hydrating onto, a hydration mismatch on `.shell`
     itself. The real, possibly-narrower, possibly-stored width/collapsed state is applied
     right after mount instead, in the useLayoutEffect below — synchronously before the
     browser paints, so there's no visible flash of the default width first. */
  const [railWidth, setRailWidth] = useState(RAIL_DEFAULT_WIDE_PX);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDE_PX);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  /** Which sidebar's handle is actively being dragged, if any — only used to suppress
   *  .shell's own width transition (app.css's .shell.is-resizing) so the drag tracks the
   *  pointer with no lag; the actual width updates happen straight from the pointer
   *  handlers in startSidebarDrag below, not through this. */
  const [resizingSide, setResizingSide] = useState<SidebarSide | null>(null);
  /** False until the post-mount hydration effect below has run once — guards the
   *  persist-to-localStorage effects so they can't fire for the fixed first-render
   *  defaults and overwrite a returning visitor's real saved width with them. State, not a
   *  ref: each persist effect must see the value that was current AT ITS OWN RENDER (a ref
   *  would already read `true` by the time ANY passive effect runs, since the layout effect
   *  below sets it before every passive effect this commit — state keeps the two renders'
   *  effect instances honestly telling apart "before" from "after" hydration). */
  const [sidebarHydrated, setSidebarHydrated] = useState(false);

  useLayoutEffect(() => {
    const rail = loadSidebar(RAIL_STORAGE_KEY, defaultRailWidth(), RAIL_MIN_PX, RAIL_MAX_PX);
    setRailWidth(rail.width);
    setRailCollapsed(rail.collapsed);
    const panel = loadSidebar(PANEL_STORAGE_KEY, defaultPanelWidth(), PANEL_MIN_PX, PANEL_MAX_PX);
    setPanelWidth(panel.width);
    setPanelCollapsed(panel.collapsed);
    setSidebarHydrated(true);
  }, []);

  useEffect(() => {
    if (!sidebarHydrated) return;
    saveSidebar(RAIL_STORAGE_KEY, { width: railWidth, collapsed: railCollapsed });
  }, [sidebarHydrated, railWidth, railCollapsed]);
  useEffect(() => {
    if (!sidebarHydrated) return;
    saveSidebar(PANEL_STORAGE_KEY, { width: panelWidth, collapsed: panelCollapsed });
  }, [sidebarHydrated, panelWidth, panelCollapsed]);

  /** Starts a drag on either sidebar's handle: tracks the pointer with plain window
   *  listeners (simpler than pointer capture here — the pointer never needs to leave the
   *  window, and the handle itself is about to be a fixed 0-width strip once collapsed, an
   *  awkward capture target) and writes the clamped width straight to state every move. */
  const startSidebarDrag = useCallback((side: SidebarSide, e: ReactPointerEvent) => {
    e.preventDefault();
    const handleEl = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startWidth = side === 'rail' ? railWidth : panelWidth;
    const [min, max] = side === 'rail' ? [RAIL_MIN_PX, RAIL_MAX_PX] : [PANEL_MIN_PX, PANEL_MAX_PX];
    const setWidth = side === 'rail' ? setRailWidth : setPanelWidth;
    const setCollapsed = side === 'rail' ? setRailCollapsed : setPanelCollapsed;
    setCollapsed(false); // dragging a collapsed sidebar's handle (from its edge tab state) reopens it
    setResizingSide(side);
    handleEl.classList.add('is-dragging');
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      // The rail grows to the right (delta positive = wider); the panel grows to the left
      // (delta positive, i.e. dragging right, = narrower) — each handle sits on its
      // sidebar's INNER edge, facing the map.
      const raw = side === 'rail' ? startWidth + delta : startWidth - delta;
      setWidth(clampPx(raw, min, max));
    };
    const onUp = () => {
      setResizingSide(null);
      handleEl.classList.remove('is-dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [railWidth, panelWidth]);

  const resetSidebarWidth = useCallback((side: SidebarSide) => {
    (side === 'rail' ? setRailWidth : setPanelWidth)(side === 'rail' ? defaultRailWidth() : defaultPanelWidth());
  }, []);

  const toggleRailCollapsed = useCallback(() => setRailCollapsed(v => !v), []);
  // Navigating (a section tab, a country) reopens a collapsed panel — otherwise the click
  // appears to do nothing. Skips the first run so a stored collapsed choice survives a load.
  const lastPathRef = useRef(location.pathname);
  useEffect(() => {
    if (lastPathRef.current === location.pathname) return;
    lastPathRef.current = location.pathname;
    setPanelCollapsed(false);
  }, [location.pathname]);
  const togglePanelCollapsed = useCallback(() => setPanelCollapsed(v => !v), []);
  /* A route's own level for the panel's Up button (features/map/up.ts useUpStep): a run leaving to its start screen */
  const [upStep, setUpStepState] = useState<(() => void) | null>(null);
  const setUpStep = useCallback((step: (() => void) | null) => setUpStepState(() => step), []);

  // "[" toggles the rail, "]" toggles the panel — ignored while typing in an input (Ctrl+[ and
  // Ctrl+] still work there: they type nothing), and desktop-only (phone has no rail and the panel is the bottom sheet, not this sidebar).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== '[' && e.key !== ']') return;
      if (isPhoneLayout()) return;
      const target = e.target;
      if (!e.ctrlKey && target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      if (e.key === '[') setRailCollapsed(v => !v);
      else setPanelCollapsed(v => !v);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /* phone layout: where the bottom sheet rests, what covers the map, and which overlay
     sheet (Layers / Progress) is open. Meaningless — and never rendered — on desktop. */
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const [immersive, setImmersive] = useState(false);
  const [overlaySheet, setOverlaySheet] = useState<OverlayName>(null);
  const panelRef = useRef<HTMLElement>(null);
  const phone = useMediaQuery(PHONE_QUERY);
  const coarse = useMediaQuery(COARSE_QUERY);
  const landscape = useMediaQuery(LANDSCAPE_QUERY);
  /* Quizzes and Questions: the sheet is peek or full, never half. */
  const twoStop = TWO_STOP_PATH.test(location.pathname);
  useSheetDrag(panelRef, { snap, onSnap: setSnap, enabled: phone && !immersive, twoStop });
  useEffect(() => {
    if (!twoStop || snap !== 'half') return;
    snapRef.current = 'full';
    setSnap('full');
  }, [twoStop, snap]);

  /* What the sheet and tab bar cover, for the camera — read through refs so an effect that
     fires in the same commit as a snap change (a cold load flying to its country) sees the
     snap it is about to have, not the last render's. */
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const immersiveRef = useRef(immersive);
  immersiveRef.current = immersive;
  const applyInsets = useCallback((atlas: MapController) => {
    // Desktop: the panel is a grid column beside the map, so nothing covers the canvas.
    // A quiz run on a phone sets its own insets (HUD above, input below) — not this.
    if (!isPhoneLayout()) return atlas.setInsets(NO_INSETS);
    if (immersiveRef.current) return;
    const top = document.querySelector<HTMLElement>('.hud--top')?.getBoundingClientRect().bottom ?? 0;
    if (isPhoneLandscape()) {
      // landscape: the slim tab bar on the left and the drawer on the right cover the sides
      const bar = document.querySelector<HTMLElement>('.tabbar')?.offsetWidth ?? 0;
      const drawer = Math.min(sheetVisible(snapRef.current, window.innerWidth, 0, true), window.innerWidth * 0.4);
      atlas.setInsets({ top: top ? top + 8 : 0, right: drawer, bottom: 0, left: bar });
      return;
    }
    const vh = window.innerHeight;
    const tab = document.querySelector<HTMLElement>('.tabbar')?.offsetHeight ?? 0;
    // A full sheet leaves a strip too thin to frame anything in, and whoever is reading the
    // dossier is not looking at the map: frame as if it were at half.
    const covered = Math.min(sheetVisible(snapRef.current, vh, tab), vh * 0.5);
    const insets: Insets = { top: top ? top + 8 : 0, right: 0, bottom: covered, left: 0 };
    atlas.setInsets(insets);
  }, []);
  useEffect(() => {
    if (atlasInstance) applyInsets(atlasInstance);
  }, [atlasInstance, applyInsets, snap, immersive, phone, landscape]);

  // The timeline's cylinder sits in what the phone's sheet and tab bar leave visible, so the
  // event names on its bottom lane are never behind them (portrait only: landscape's drawer is
  // beside the canvas, not over its bottom).
  useEffect(() => {
    const timeline = historyTimelineInstance;
    if (!timeline) return;
    if (!isPhoneLayout() || isPhoneLandscape()) return timeline.setCrossInsets(0, 0);
    const vh = window.innerHeight;
    const tab = document.querySelector<HTMLElement>('.tabbar')?.offsetHeight ?? 0;
    const top = document.querySelector<HTMLElement>('.hud--top')?.getBoundingClientRect().bottom ?? 0;
    // A full sheet leaves too thin a strip: frame as if at half, like the map
    timeline.setCrossInsets(top ? top + 8 : 0, Math.min(sheetVisible(snap, vh, tab), vh * 0.5));
  }, [historyTimelineInstance, snap, phone, landscape, showTimeline]);

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
      navigate(feature ? `/country/${feature.country.slug}` : '/', { state: { sheet: isPhoneLandscape() ? 'half' : 'peek' } });
    },
    [armingCompare, navigate, quiz]
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
    loadMapEngine()
      .then(engine => {
        if (cancelled) return null;
        return engine.create(
          host,
          world,
          {
            onHover: (feature, x, y, place, labelShown) => {
              setHovered(feature);
              setHoveredPlace(place ?? null);
              setTip(feature && !labelShown ? { x, y } : null);
            },
            onSelect: f => handleSelectRef.current(f),
            onCameraChange: setScale,
            onCompareMove: (feature, over) => setComparing({ feature, over })
          },
          {
            fill: f => fillFor(f, styleRef.current),
            stroke: f => strokeFor(f, styleRef.current),
            defaultStroke: defaultStrokeFor,
            showLabels: true,
            showPins: true,
            showCapitals: true
          }
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
        setAtlasInstance(atlas);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => {
      cancelled = true;
      if (created) {
        created.destroy();
        atlasRef.current = null;
        setAtlasInstance(null);
      }
    };
  }, [world, applyInsets]);

  /**
   * The history timeline controller — constructed once entries arrive (a history route
   * pushed them via AtlasContext) and torn down once they're cleared (leaving that route).
   * Its own canvas sits underneath the map's, shown/hidden by `showTimeline` below; unlike
   * Atlas, it owns its own pan/zoom entirely (see CLAUDE.md's history exception) so nothing
   * else here drives it.
   */
  useEffect(() => {
    if (!timelineEntries || !historyCanvasRef.current || timelineRef.current) return;
    const timeline = new HistoryTimeline(historyCanvasRef.current, {
      axis: 'horizontal', entries: timelineEntries, pastLabel: timelineLabels.pastLabel, futureLabel: timelineLabels.futureLabel,
      onHover: setHistoryHover, onEntryClick: handleEntryClick,
      onPeriodChange: setHistoryCurrentPeriodId
    });
    timelineRef.current = timeline;
    setHistoryTimelineInstance(timeline);
    return () => {
      timeline.destroy();
      timelineRef.current = null;
      setHistoryTimelineInstance(null);
      setHistoryCurrentPeriodId(null);
      setHistoryHover(null);
    };
    // handleEntryClick is stable (useCallback, no deps) — the controller is built once per
    // entries array, same as before this effect took a second callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineEntries]);

  /** Keeps the canvas's persistent pinned-entry outline (renderer.ts) in sync with React's
   *  own pinned-card state, without rebuilding the controller. */
  useEffect(() => {
    timelineRef.current?.setPinnedIds(new Set(pinnedCards.map(p => p.id)));
  }, [pinnedCards]);

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
            quizMode: true
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
    const target = asked === 'half' && TWO_STOP_PATH.test(location.pathname) ? 'full' : asked;
    snapRef.current = target; // the fly effect below runs in this same flush
    setSnap(target);
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

  const historyPinnedIds = useMemo(() => pinnedCards.map(p => p.id), [pinnedCards]);

  const canvasClass = [
    'stage__canvas',
    armingCompare ? 'is-picking' : '',
    quiz?.paused ? 'is-quiz-paused' : '',
    showTimeline ? 'is-hidden' : ''
  ].filter(Boolean).join(' ');

  return (
    <AtlasContext.Provider
      value={{
        atlas: atlasInstance, quiz, setQuiz, setImmersive, setSheetSnap: setSnap,
        setTimelineEntries, setTimelineLabels,
        historyPinnedIds, closeAllHistoryCards, selectedHistoryEntryId, setSelectedHistoryEntryId, pinHistoryEntry,
        historyTimeline: historyTimelineInstance, historyCurrentPeriodId,
        historyHiddenKinds, toggleHistoryKind, historyHiddenCategories, toggleHistoryCategory, resetHistoryFilters,
        upStep, setUpStep
      }}
    >
    <div
      className={`shell${immersive ? ' is-immersive' : ''}${quiz ? ' is-quiz' : ''}${resizingSide ? ' is-resizing' : ''}`}
      style={{
        '--rail-width': `${railCollapsed ? 0 : railWidth}px`,
        '--panel-width': `${panelCollapsed ? 0 : panelWidth}px`,
        // room for a collapsed side's edge tab, so full-area screens never sit under it
        '--rail-gap': railCollapsed ? '40px' : '0px',
        '--panel-gap': panelCollapsed ? '40px' : '0px'
      } as CSSProperties}
    >
      <Rail
        overlay={overlay}
        onOverlayChange={setOverlay}
        countryCount={world?.features.length ?? 0}
        totals={totals}
        collapsed={railCollapsed}
        onToggleCollapsed={toggleRailCollapsed}
        onHandlePointerDown={e => startSidebarDrag('rail', e)}
        onHandleDoubleClick={() => resetSidebarWidth('rail')}
      />

      <main className="stage">
        <div ref={mapHostRef} className={canvasClass} role="img" aria-label="World map" />
        <canvas
          ref={historyCanvasRef}
          className={`stage__canvas${showTimeline ? '' : ' is-hidden'}`}
          aria-label="History timeline"
        />

        {showTimeline && historyHover && timelineEntries && !historyPinnedIds.includes(historyHover.entry.id) && (
          <HistoryCard
            entry={historyHover.entry}
            rect={historyHover.rect}
            entries={timelineEntries}
            bounds={{
              width: historyCanvasRef.current?.clientWidth ?? 0,
              height: historyCanvasRef.current?.clientHeight ?? 0
            }}
          />
        )}

        {showTimeline && timelineEntries &&
          pinnedCards.map(card => (
            <PinnedHistoryCard
              key={card.id}
              entry={card.entry}
              entries={timelineEntries}
              initialRect={card.rect}
              bounds={{
                width: historyCanvasRef.current?.clientWidth ?? 0,
                height: historyCanvasRef.current?.clientHeight ?? 0
              }}
              zIndex={card.z}
              timeline={historyTimelineInstance}
              onClose={handleCardClose}
              onFront={handleCardFront}
              onSeeMore={setSelectedHistoryEntryId}
              onRectChange={handleCardRectChange}
            />
          ))}

        {!quiz && !showTimeline && (
          <div className="hud hud--top">
            <SearchBox
              world={world}
              onPick={feature =>
                navigate(`/country/${feature.country.slug}`, { state: { fly: true, sheet: isPhoneLandscape() ? 'half' : 'peek' } })
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
                aria-pressed={micro !== 'off'}
                data-state={micro}
                title="Micro-states and islands: full, dots, off"
                onClick={() => setMicro(nextMicro)}
              >
                Micro: {MICRO_LABEL[micro]}
              </button>
              <button
                type="button"
                className="tool"
                aria-pressed={showCapitals}
                onClick={() => setShowCapitals(v => !v)}
              >
                Capitals
              </button>
              <button
                type="button"
                className="tool"
                aria-pressed={showNames}
                onClick={() => setShowNames(v => !v)}
              >
                Names
              </button>
            </div>
          </div>
        )}

        {!showTimeline && (
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
        )}

        {!quiz && !showTimeline && hovered && tip && !coarse && (
          <div className="tip glass" style={{ left: tip.x, top: tip.y }}>
            <span>{hovered.country.emoji}</span>
            <span>{hoveredPlace ? hoveredPlace.place.name : hovered.country.name}</span>
          </div>
        )}

        {!showTimeline && (comparing || armingCompare) && (
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

        {!showTimeline && error && (
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
              onPointerDown={e => startSidebarDrag('panel', e)}
              onDoubleClick={() => resetSidebarWidth('panel')}
            />
            {!panelCollapsed && <UpButton />}
            {panelCollapsed && (
              <button
                type="button"
                className="sidebar-edge-tab"
                title="Expand panel (])"
                aria-label="Expand panel"
                onClick={togglePanelCollapsed}
              >
                <EdgeArrow dir="left" />
              </button>
            )}
          </>
        )}
        <div className="panel__content">
          <SheetGrip snap={snap} twoStop={twoStop} onStep={() => setSnap(stepSnap(snap, twoStop))} />
          <Outlet />
        </div>
        {!phone && !panelCollapsed && (
          <button
            type="button"
            className="sidebar-collapse"
            title="Collapse panel (])"
            aria-label="Collapse panel"
            onClick={togglePanelCollapsed}
          >
            ›
          </button>
        )}
      </aside>

      <TabBar overlay={overlaySheet} onOverlay={setOverlaySheet} />
      <LayersSheet
        open={overlaySheet === 'layers'}
        onClose={() => setOverlaySheet(null)}
        overlay={overlay}
        onOverlayChange={setOverlay}
        showNeighbours={showNeighbours}
        onNeighbours={() => setShowNeighbours(v => !v)}
        micro={micro}
        onMicro={() => setMicro(nextMicro)}
        showCapitals={showCapitals}
        onCapitals={() => setShowCapitals(v => !v)}
        showNames={showNames}
        onNames={() => setShowNames(v => !v)}
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
