export interface ParsedHistoryDate {
  raw: string;
  year: number;
  month: number | null;
  day: number | null;
}

export type HistoryEntryKind = 'period' | 'ruler' | 'government' | 'event';
export type HistoryPrecision = 'exact' | 'year' | 'circa' | 'disputed';
export type HistoryStyle = 'old' | 'new';

export interface HistoryEntry {
  id: string;
  kind: HistoryEntryKind;
  name: { bg: string; en: string };
  aliases: string[];
  role: string | null;
  start: string;
  end: string | null;
  startYear: number;
  endYear: number | null;
  precision: HistoryPrecision;
  style: HistoryStyle;
  tier: number;
  parent: string | null;
  blurb: { bg: string; en: string };
}

export function parseHistoryDate(raw: string | number, where: string): ParsedHistoryDate;
export function dateKey(d: Pick<ParsedHistoryDate, 'year' | 'month' | 'day'>): number;
export function validateHistory(doc: unknown, where: string): HistoryEntry[];
