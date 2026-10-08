/**
 * Phone layout of the atlas shell: where the bottom sheet rests (snap), what covers the map
 * (immersive, the open overlay sheet), what the camera and the timeline's cylinder keep clear
 * of, and where the sheet goes after a navigation. Meaningless on desktop — never rendered there.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';

import type { HistoryTimeline } from '~/features/history';
import { NO_INSETS, type Insets } from '~/engines/map/camera';
import type { MapController } from '~/engines/map/controller';
import { sheetVisible, useSheetDrag, type SheetSnap } from '~/shared/layout/sheet';
import { COARSE_QUERY, isPhoneLandscape, isPhoneLayout, LANDSCAPE_QUERY, PHONE_QUERY, useMediaQuery } from '~/shared/layout/viewport';
import type { OverlayName } from '../components/MobileChrome';
import { isQuizRunPath } from '../up';

/** Routes whose phone sheet has no half snap (the History timeline keeps peek / half / full). */
export const TWO_STOP_PATH = /^\/(quizzes|questions)(\/|$)/;
/** A quiz run's own route is the exception: its sheet only shows the results, which rest at half so
 *  the map (names, clickable countries) stays visible above them. */
const twoStopPath = (pathname: string) => TWO_STOP_PATH.test(pathname) && !isQuizRunPath(pathname);

export function usePhoneSheet({ historyTimelineInstance, showTimeline }: {
  historyTimelineInstance: HistoryTimeline | null;
  showTimeline: boolean;
}) {
  const location = useLocation();
  /* Quizzes and Questions: the sheet is peek or full, never half. */
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
  const twoStop = twoStopPath(location.pathname);
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
    const target = asked === 'half' && twoStopPath(location.pathname) ? 'full' : asked;
    snapRef.current = target; // the fly effect below runs in this same flush
    setSnap(target);
  }, [location.key, location.pathname, location.state]);

  return {
    snap, setSnap, immersive, setImmersive, overlaySheet, setOverlaySheet, panelRef,
    phone, coarse, landscape, twoStop, applyInsets
  };
}
