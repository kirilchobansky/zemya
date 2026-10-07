/** Date and label formatting shared by the hover card, the pinned card and the outline. */
import type { TimelineEntry } from '~/features/history/timeline/renderer';
import { dateOfDecimalYear, formatDuration } from '~/features/history/timeline/scale';

export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  war: 'War',
  treaty: 'Treaty',
  uprising: 'Uprising',
  church: 'Church',
  culture: 'Culture',
  politics: 'Politics',
  economy: 'Economy',
  disaster: 'Disaster',
  ruler: 'Ruler'
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function yearLabel(year: number): string {
  return year < 0 ? `${-year} BC` : String(year);
}

/** dd.mm.yyyy; year only when the month is unknown; "c. <year>" for circa precision —
 *  see the hover brief. Exported for the pinned card's detail panel (routes/
 *  history.$slug.tsx), which formats the same way rather than re-deriving it. */
export function formatCardDate(t: number, precision: TimelineEntry['precision']): string {
  const d = dateOfDecimalYear(t);
  if (precision === 'circa') return `c. ${yearLabel(d.year)}`;
  if (d.month == null) return yearLabel(d.year);
  return `${pad2(d.day ?? 1)}.${pad2(d.month)}.${yearLabel(d.year)}`;
}

/** "1887 – 1918 · 31 years" — duration via scale.ts's shared formatDuration. */
export function formatRangeLine(startT: number, endT: number): string {
  const start = dateOfDecimalYear(startT).year;
  const end = dateOfDecimalYear(endT).year;
  return `${yearLabel(start)} – ${yearLabel(end)} · ${formatDuration(startT, endT)}`;
}
