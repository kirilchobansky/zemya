export const formatNumber = (n: number): string => (n || 0).toLocaleString('en-US');

export function formatCompact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} bn`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} m`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} k`;
  return String(n);
}

/** Lower-case, strip accents and punctuation — for search and answer matching. */
export function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}
