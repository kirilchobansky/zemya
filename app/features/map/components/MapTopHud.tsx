import type { Dispatch, SetStateAction } from 'react';

import { SearchBox } from '~/features/countries';
import type { MicroMode } from '~/engines/map/style';
import type { World } from '~/engines/map/types';
import { MICRO_LABEL, nextMicro } from '../micro';
import { LayersIcon, type OverlayName } from './MobileChrome';

/** The top bar over the map: country search, the phone's Layers button and the tool toggles. */
export function MapTopHud({
  world, onPick, overlaySheet, onOverlaySheet, comparing, armingCompare, onCompare,
  showNeighbours, onShowNeighbours, micro, onMicro, showCapitals, onShowCapitals, showNames, onShowNames
}: {
  world: World | null;
  onPick: Parameters<typeof SearchBox>[0]['onPick'];
  overlaySheet: OverlayName;
  onOverlaySheet: Dispatch<SetStateAction<OverlayName>>;
  comparing: boolean;
  armingCompare: boolean;
  onCompare: () => void;
  showNeighbours: boolean;
  onShowNeighbours: () => void;
  micro: MicroMode;
  onMicro: () => void;
  showCapitals: boolean;
  onShowCapitals: () => void;
  showNames: boolean;
  onShowNames: () => void;
}) {
  return (
    <div className="hud hud--top">
      <SearchBox
        world={world}
        onPick={onPick}
      />
      <button
        type="button"
        className="layers-btn"
        aria-label="Layers"
        aria-expanded={overlaySheet === 'layers'}
        onClick={() => onOverlaySheet(o => (o === 'layers' ? null : 'layers'))}
      >
        <LayersIcon />
      </button>
      <div className="toolbar glass">
        <button
          type="button"
          className="tool"
          aria-pressed={comparing || armingCompare}
          onClick={onCompare}
        >
          ⇲ Compare size
        </button>
        <button
          type="button"
          className="tool"
          aria-pressed={showNeighbours}
          onClick={onShowNeighbours}
        >
          Neighbour glow
        </button>
        <button
          type="button"
          className="tool"
          aria-pressed={micro !== 'off'}
          data-state={micro}
          title="Micro-states and islands: on or off"
          onClick={onMicro}
        >
          Micro: {MICRO_LABEL[micro]}
        </button>
        <button
          type="button"
          className="tool"
          aria-pressed={showCapitals}
          onClick={onShowCapitals}
        >
          Capitals
        </button>
        <button
          type="button"
          className="tool"
          aria-pressed={showNames}
          onClick={onShowNames}
        >
          Names
        </button>
      </div>
    </div>
  );
}
