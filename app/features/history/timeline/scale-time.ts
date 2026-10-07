/** Decimal-year time representation and duration formatting (see scale.ts for why `Date` is never used). */
import { dateKey, parseHistoryDate, type ParsedHistoryDate } from '../../../../scripts/lib/history.mjs';

/* ------------------------------------------------------------------- time representation */

export const SLOTS_PER_MONTH = 31;
const SLOTS_PER_YEAR = 12 * SLOTS_PER_MONTH; // 372 — see the module header on why "day" is synthetic

/** A parsed date (from scripts/lib/history.mjs) as a decimal year: 1878.17-ish for
 *  3 March 1878, exactly -450 for the year 450 BC (astronomical numbering, matching the
 *  parser). Year-only dates have no fractional part at all, not an implied "1 January". */
export function decimalYearOfDate(d: Pick<ParsedHistoryDate, 'year' | 'month' | 'day'>): number {
  if (d.month == null) return d.year;
  const slot = (d.month - 1) * SLOTS_PER_MONTH + ((d.day ?? 1) - 1);
  return d.year + slot / SLOTS_PER_YEAR;
}

/** Inverse of decimalYearOfDate. An exact integer round-trips to a year-only date (month
 *  and day both null) — the same convention decimalYearOfDate reads on the way in. */
export function dateOfDecimalYear(t: number): ParsedHistoryDate {
  const year = Math.floor(t);
  const frac = t - year;
  if (frac === 0) return { raw: String(year), year, month: null, day: null };
  const slot = Math.min(Math.max(Math.round(frac * SLOTS_PER_YEAR), 0), SLOTS_PER_YEAR - 1);
  const month = Math.floor(slot / SLOTS_PER_MONTH) + 1;
  const day = (slot % SLOTS_PER_MONTH) + 1;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return { raw: `${year}-${pad2(month)}-${pad2(day)}`, year, month, day };
}

/** Convenience: the authored string straight to a decimal year, for content that hasn't
 *  been parsed yet. `where` is only used in the parser's own error message. */
export function decimalYearOf(raw: string, where = 'decimalYearOf'): number {
  return decimalYearOfDate(parseHistoryDate(raw, where));
}

/** Human duration between two decimal years, shared by the card and the detail view.
 *  When either end carries a month (day-precise), uses the real calendar day difference:
 *  under 60 days -> "N days"; up to 24 months -> rounded months (days / 30.44); beyond
 *  that -> "N years", plus " N months" when months remain and years < 10. Year-precision
 *  ends keep whole years, with "less than a year" instead of "0 years". */
export function formatDuration(startT: number, endT: number): string {
  const a = dateOfDecimalYear(startT);
  const b = dateOfDecimalYear(endT);
  const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;
  // A whole-number decimal year is year-only OR 1 January (indistinguishable, see
  // dateOfDecimalYear), so a span is day-precise as soon as EITHER end has a fraction.
  if (a.month != null || b.month != null) {
    const utc = (d: ParsedHistoryDate): number => {
      const dt = new Date(0);
      dt.setUTCFullYear(d.year, (d.month ?? 1) - 1, d.day ?? 1);
      return dt.getTime();
    };
    const days = Math.round((utc(b) - utc(a)) / 86400000);
    if (days < 60) return plural(days, 'day');
    const months = Math.round(days / 30.44);
    if (months < 24) return plural(months, 'month');
    const years = Math.floor(months / 12);
    const rest = months % 12;
    return years < 10 && rest >= 1
      ? `${plural(years, 'year')} ${plural(rest, 'month')}`
      : plural(years, 'year');
  }
  const years = b.year - a.year;
  return years <= 0 ? 'less than a year' : plural(years, 'year');
}

export { dateKey };
