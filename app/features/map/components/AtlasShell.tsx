/**
 * The atlas shell. Owns the canvas, the camera and every piece of map state; the child
 * routes render only the right-hand panel. Selection lives in the URL, so a country page
 * can be linked to directly; whether a selection *also* moves the camera is carried in the
 * navigation's state rather than inferred from the selection itself.
 *
 * The state lives in hooks (../hooks): the map controller, the history canvas, the desktop
 * sidebars and the phone sheet. This component wires them to the layout.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useGo } from '~/shared/lib/navigation';

import type { OverlayId, QuizOverride } from '~/features/countries';
import type { MicroMode } from '~/engines/map/style';
import { sheetVisible } from '~/shared/layout/sheet';
import { isPhoneLandscape } from '~/shared/layout/viewport';
import { AtlasContext } from '../atlas-context';
import { useHistoryCanvas } from '../hooks/use-history-canvas';
import { useMapController } from '../hooks/use-map-controller';
import { usePhoneSheet } from '../hooks/use-phone-sheet';
import { useSidebars } from '../hooks/use-sidebars';
import { nextMicro } from '../micro';
import { AtlasPanel } from './AtlasPanel';
import { HistoryLayer } from './HistoryLayer';
import { LayersSheet, ProgressSheet, TabBar } from './MobileChrome';
import { MapBottomHud } from './MapBottomHud';
import { MapNotices } from './MapNotices';
import { MapTopHud } from './MapTopHud';
import { Rail } from './Rail';

export function AtlasShell() {
  const go = useGo();
  const history = useHistoryCanvas();
  const sidebars = useSidebars();
  const sheet = usePhoneSheet({ historyTimelineInstance: history.historyTimelineInstance, showTimeline: history.showTimeline });

  const [overlay, setOverlay] = useState<OverlayId>('terrain');
  const [showNeighbours, setShowNeighbours] = useState(true);
  const [micro, setMicro] = useState<MicroMode>('full');
  const [showNames, setShowNames] = useState(true);
  const [showCapitals, setShowCapitals] = useState(true);
  const [quiz, setQuiz] = useState<QuizOverride | null>(null);
  /* A route's own level for the panel's Up button (features/map/up.ts useUpStep): a run leaving to its start screen */
  const [upStep, setUpStepState] = useState<(() => void) | null>(null);
  const setUpStep = useCallback((step: (() => void) | null) => setUpStepState(() => step), []);

  const map = useMapController({
    overlay, showNeighbours, micro, showNames, showCapitals, quiz, applyInsets: sheet.applyInsets
  });
  const { atlasInstance } = map;
  useEffect(() => {
    if (atlasInstance) sheet.applyInsets(atlasInstance);
  }, [atlasInstance, sheet.applyInsets, sheet.snap, sheet.immersive, sheet.phone, sheet.landscape]);

  const { showTimeline } = history;
  const canvasClass = [
    'stage__canvas',
    map.armingCompare ? 'is-picking' : '',
    quiz?.paused ? 'is-quiz-paused' : '',
    showTimeline ? 'is-hidden' : ''
  ].filter(Boolean).join(' ');
  /* A pinned card's "See more" on a phone: the detail opens in the sheet at half, never over a
     peek or a full sheet. Cards keep clear of whatever the sheet covers (as the timeline's cylinder does). */
  const { setSelectedHistoryEntryId } = history;
  const { phone: onPhone, landscape: onLandscape, snap: sheetSnap, setSnap: setSheetSnap } = sheet;
  const openEntry = useCallback((id: string) => {
    setSelectedHistoryEntryId(id);
    if (onPhone) setSheetSnap('half');
  }, [setSelectedHistoryEntryId, onPhone, setSheetSnap]);
  const cardBottomInset = onPhone && !onLandscape && typeof document !== 'undefined'
    ? Math.min(sheetVisible(sheetSnap, window.innerHeight, document.querySelector<HTMLElement>('.tabbar')?.offsetHeight ?? 0), window.innerHeight * 0.5)
    : 0;
  const comparingOrArming = Boolean(map.comparing) || map.armingCompare;

  return (
    <AtlasContext.Provider
      value={{
        atlas: atlasInstance, quiz, setQuiz, setImmersive: sheet.setImmersive, setSheetSnap: sheet.setSnap,
        setTimelineEntries: history.setTimelineEntries, setTimelineLabels: history.setTimelineLabels,
        historyPinnedIds: history.historyPinnedIds, closeAllHistoryCards: history.closeAllHistoryCards,
        selectedHistoryEntryId: history.selectedHistoryEntryId, setSelectedHistoryEntryId: history.setSelectedHistoryEntryId,
        pinHistoryEntry: history.pinHistoryEntry,
        historyTimeline: history.historyTimelineInstance, historyCurrentPeriodId: history.historyCurrentPeriodId,
        historyHiddenKinds: history.historyHiddenKinds, toggleHistoryKind: history.toggleHistoryKind,
        historyHiddenCategories: history.historyHiddenCategories, toggleHistoryCategory: history.toggleHistoryCategory,
        resetHistoryFilters: history.resetHistoryFilters,
        upStep, setUpStep
      }}
    >
      <div
        className={`shell${sheet.immersive ? ' is-immersive' : ''}${quiz ? ' is-quiz' : ''}${sidebars.resizingSide ? ' is-resizing' : ''}`}
        style={{
          '--rail-width': `${sidebars.railCollapsed ? 0 : sidebars.railWidth}px`,
          '--panel-width': `${sidebars.panelCollapsed ? 0 : sidebars.panelWidth}px`,
          // room for a collapsed side's edge tab, so full-area screens never sit under it
          '--rail-gap': sidebars.railCollapsed ? '40px' : '0px',
          '--panel-gap': sidebars.panelCollapsed ? '40px' : '0px'
        } as CSSProperties}
      >
        <Rail
          overlay={overlay}
          onOverlayChange={setOverlay}
          countryCount={map.world?.features.length ?? 0}
          totals={map.totals}
          collapsed={sidebars.railCollapsed}
          onToggleCollapsed={sidebars.toggleRailCollapsed}
          onHandlePointerDown={e => sidebars.startSidebarDrag('rail', e)}
          onHandleDoubleClick={() => sidebars.resetSidebarWidth('rail')}
        />

        <main className="stage">
          {/* React owns the wrapper's className; MapLibre owns the inner host's (it adds
              maplibregl-map), which React never rewrites */}
          <div className={canvasClass}>
            <div ref={map.mapHostRef} className="stage__map" role="img" aria-label="World map" />
          </div>
          <HistoryLayer
            canvasRef={history.historyCanvasRef}
            showTimeline={showTimeline}
            bottomInset={cardBottomInset}
            hover={history.historyHover}
            entries={history.timelineEntries}
            pinnedCards={history.pinnedCards}
            pinnedIds={history.historyPinnedIds}
            timeline={history.historyTimelineInstance}
            onClose={history.handleCardClose}
            onFront={history.handleCardFront}
            onSeeMore={openEntry}
            onRectChange={history.handleCardRectChange}
          />

          {!quiz && !showTimeline && (
            <MapTopHud
              world={map.world}
              onPick={feature =>
                go(`/country/${feature.country.slug}`, { state: { fly: true, sheet: isPhoneLandscape() ? 'half' : 'peek' } })
              }
              overlaySheet={sheet.overlaySheet}
              onOverlaySheet={sheet.setOverlaySheet}
              comparing={Boolean(map.comparing)}
              armingCompare={map.armingCompare}
              onCompare={map.toggleCompare}
              showNeighbours={showNeighbours}
              onShowNeighbours={() => setShowNeighbours(v => !v)}
              micro={micro}
              onMicro={() => setMicro(nextMicro)}
              showCapitals={showCapitals}
              onShowCapitals={() => setShowCapitals(v => !v)}
              showNames={showNames}
              onShowNames={() => setShowNames(v => !v)}
            />
          )}

          {!showTimeline && (
            <MapBottomHud atlasRef={map.atlasRef} quiz={Boolean(quiz)} onHome={() => go('/')} scale={map.scale} />
          )}

          <MapNotices
            showTimeline={showTimeline}
            quiz={Boolean(quiz) && !quiz?.onInspect}
            coarse={sheet.coarse}
            hovered={map.hovered}
            hoveredPlace={map.hoveredPlace}
            tip={map.tip}
            tipRef={map.tipRef}
            comparing={map.comparing}
            armingCompare={map.armingCompare}
            onCompare={map.toggleCompare}
            error={map.error}
            retrying={map.retrying}
            restoring={map.restoring}
            onRetry={map.retry}
          />
        </main>

        <AtlasPanel
          panelRef={sheet.panelRef}
          snap={sheet.snap}
          onSnap={sheet.setSnap}
          twoStop={sheet.twoStop}
          immersive={sheet.immersive}
          phone={sheet.phone}
          panelCollapsed={sidebars.panelCollapsed}
          onStartDrag={e => sidebars.startSidebarDrag('panel', e)}
          onResetWidth={() => sidebars.resetSidebarWidth('panel')}
          onToggleCollapsed={sidebars.togglePanelCollapsed}
        />

        <TabBar overlay={sheet.overlaySheet} onOverlay={sheet.setOverlaySheet} />
        <LayersSheet
          open={sheet.overlaySheet === 'layers'}
          onClose={() => sheet.setOverlaySheet(null)}
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
          comparing={comparingOrArming}
          onCompare={map.toggleCompare}
        />
        <ProgressSheet open={sheet.overlaySheet === 'progress'} onClose={() => sheet.setOverlaySheet(null)} totals={map.totals} />
      </div>
    </AtlasContext.Provider>
  );
}
