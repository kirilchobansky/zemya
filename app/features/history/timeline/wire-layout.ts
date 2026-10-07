/**
 * Vertical layout of the four lanes (wires): sub-row heights and offsets.
 */
import { type WireLayout } from './render-types';
import { RENDER_CONFIG, WIRE_ORDER } from './render-colors';
import { rowHeightFor } from './render-geometry';
import { type EntryKind } from './scale';

/**
 * One row per kind, ALWAYS, in duration order (WIRE_ORDER) — a kind reserves its lane
 * whether or not anything of that kind is on screen right now, so a lane never collapses,
 * hides or fades for lack of visible items ("empty lanes stay visible as a faint empty
 * track"). A pure function of `subRowCounts` (laneSubRowCounts, computed once from the
 * whole dataset by the caller, never from what's currently visible) — nothing here depends
 * on zoom, the viewport's pan position, or which entries are on screen, so the whole
 * wire/lane structure (and the cylinder it's held in) is completely static; only entries'
 * own along-axis position moves (drawWireCapsules/drawEventPins, via classifySpan/
 * timeToPx). Each lane's total height is simply its own fixed row height times its own
 * fixed sub-row count — no lane ever stretches to fill spare space, and no capsule ever
 * stretches to fill its lane (drawWireCapsules always draws at rowHeightFor's own height,
 * never wire.height itself when subRows > 1).
 */
export function layoutWires(subRowCounts: Readonly<Record<EntryKind, number>>, contentTop: number): Record<EntryKind, WireLayout> {
  const out = {} as Record<EntryKind, WireLayout>;
  let top = contentTop;
  for (const kind of WIRE_ORDER) {
    const subRows = Math.max(1, subRowCounts[kind] ?? 1);
    const rowHeight = rowHeightFor(kind);
    const height = rowHeight * subRows;
    out[kind] = { top, height, rowHeight, subRows };
    top += height + RENDER_CONFIG.wireGap;
  }
  return out;
}

/** The total px height every lane together needs — a constant per dataset shape
 *  (`subRowCounts`), never a function of zoom. This IS the cylinder's own thickness (see
 *  render()) rather than a floor some separately-animated size is grown to fit. */
export function totalWiresHeightPx(subRowCounts: Readonly<Record<EntryKind, number>>): number {
  let total = RENDER_CONFIG.wireGap * (WIRE_ORDER.length - 1);
  for (const kind of WIRE_ORDER) {
    total += rowHeightFor(kind) * Math.max(1, subRowCounts[kind] ?? 1);
  }
  return total;
}
