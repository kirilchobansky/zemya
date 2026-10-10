/**
 * The grid of rectangles of a "fill the list" run: one per entry, in chronological order,
 * showing only its years until it is filled (or revealed after giving up).
 */
import type { CSSProperties } from 'react';

import { dateRangeLabel, isShownTitle, splitNote, yearLabel, type FillEntry } from './fill-quiz';

/** Read-down layout: tall columns first. Up to 6 entries make one column, up to 12 two, and
 *  up to 30 three, and longer four (desktop); a phone takes one column up to 8 entries, else two. Items
 *  run top to bottom, then on to the next column. */
function columnLayout(n: number): CSSProperties {
  const cols = n <= 6 ? 1 : n <= 12 ? 2 : n <= 30 ? 3 : 4;
  const phoneCols = n <= 8 ? 1 : 2;
  return {
    '--cols': cols,
    '--rows': Math.ceil(n / cols),
    '--cols-phone': phoneCols,
    '--rows-phone': Math.ceil(n / phoneCols),
  } as CSSProperties;
}

export function FillGrid({ entries, filled, revealing, showTitles, byColumns }: {
  entries: readonly FillEntry[];
  filled: ReadonlySet<string>;
  revealing: boolean;
  showTitles: boolean;
  byColumns: boolean;
}) {
  return (
    <ol
      className={
        `fill-quiz__grid${byColumns ? ' fill-quiz__grid--columns' : ''}` +
        (byColumns && entries.length <= 8 ? ' fill-quiz__grid--one' : '') +
        (entries.length > 30 ? ' fill-quiz__grid--compact' : '')
      }
      style={byColumns ? columnLayout(entries.length) : undefined}
    >
      {entries.map(entry => {
        const isFilled = filled.has(entry.id);
        const isMissed = revealing && !isFilled;
        const shown = isFilled || isMissed;
        const title = showTitles && isShownTitle(entry.title) ? entry.title : '';
        const label = title ? `${title} ${entry.name}` : entry.name;
        const { main, note } = splitNote(entry.name);
        return (
          <li
            key={entry.id}
            data-entry={entry.id}
            className={
              `fill-cell fill-cell--${entry.kind}` +
              (isFilled ? ' is-filled' : '') + (isMissed ? ' is-missed' : '')
            }
            title={shown ? `${label} · ${dateRangeLabel(entry)}` : undefined}
            aria-label={shown ? label : `Empty, ${yearLabel(entry)}`}
          >
            <span className="fill-cell__dates numeric">{yearLabel(entry)}</span>
            <span className="fill-cell__name">
              {shown && title && <span className="fill-cell__title">{title}</span>}
              {shown ? main : ''}
              {shown && note && <span className="fill-cell__note">{note}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
