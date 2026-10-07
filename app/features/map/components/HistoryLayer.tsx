import type { RefObject } from 'react';

import {
  HistoryCard, PinnedHistoryCard, type HistoryHover, type HistoryTimeline, type TimelineEntry
} from '~/features/history';

type Rect = { x: number; y: number; w: number; h: number };

/** The history timeline's canvas and the cards over it: the hover card and the pinned cards. */
export function HistoryLayer({
  canvasRef, showTimeline, hover, entries, pinnedCards, pinnedIds, timeline, onClose, onFront, onSeeMore, onRectChange
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  showTimeline: boolean;
  hover: HistoryHover | null;
  entries: TimelineEntry[] | null;
  pinnedCards: { id: string; entry: TimelineEntry; rect: Rect; z: number }[];
  pinnedIds: readonly string[];
  timeline: HistoryTimeline | null;
  onClose: (id: string) => void;
  onFront: (id: string) => void;
  onSeeMore: (id: string) => void;
  onRectChange: (id: string, rect: Rect) => void;
}) {
  return (
    <>
    <canvas
      ref={canvasRef}
      className={`stage__canvas${showTimeline ? '' : ' is-hidden'}`}
      aria-label="History timeline"
    />

    {showTimeline && hover && entries && !pinnedIds.includes(hover.entry.id) && (
      <HistoryCard
        entry={hover.entry}
        rect={hover.rect}
        entries={entries}
        bounds={{
          width: canvasRef.current?.clientWidth ?? 0,
          height: canvasRef.current?.clientHeight ?? 0
        }}
      />
    )}

    {showTimeline && entries &&
      pinnedCards.map(card => (
        <PinnedHistoryCard
          key={card.id}
          entry={card.entry}
          entries={entries}
          initialRect={card.rect}
          bounds={{
            width: canvasRef.current?.clientWidth ?? 0,
            height: canvasRef.current?.clientHeight ?? 0
          }}
          zIndex={card.z}
          timeline={timeline}
          onClose={onClose}
          onFront={onFront}
          onSeeMore={onSeeMore}
          onRectChange={onRectChange}
        />
      ))}
    </>
  );
}
