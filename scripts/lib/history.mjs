/**
 * Date parsing and validation for content/history/*.yaml. Split out of
 * build-history.mjs so test/unit/history.test.ts can exercise it directly, without
 * running the full build.
 */

const KINDS = new Set(['period', 'ruler', 'government', 'event']);
const PRECISIONS = new Set(['exact', 'year', 'circa', 'disputed']);
const STYLES = new Set(['old', 'new']);

/**
 * Accepts a signed year ("681", "-450") or a full date ("811-07-26", "-450-03-01").
 * Negative years are astronomical (ISO 8601) numbering: "-450" is 451 BC. Bulgaria's
 * own content never needs BC, but the format has to parse it correctly for whatever
 * subject reuses this next — hence the explicit sign group rather than assuming a plain
 * `\d+` year.
 */
const DATE_RE = /^(-?\d+)(?:-(\d{2})-(\d{2}))?$/;

export function parseHistoryDate(raw, where) {
  const s = String(raw).trim();
  const m = s.match(DATE_RE);
  if (!m) {
    throw new Error(`${where}: "${raw}" is not a valid date (expected YYYY, -YYYY, YYYY-MM-DD or -YYYY-MM-DD)`);
  }
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : null;
  const day = m[3] ? Number(m[3]) : null;
  if (month !== null && (month < 1 || month > 12)) throw new Error(`${where}: "${raw}" has an invalid month`);
  if (day !== null && (day < 1 || day > 31)) throw new Error(`${where}: "${raw}" has an invalid day`);
  return { raw: s, year, month, day };
}

/** Sortable key for comparing two parsed dates. A whole year apart always dominates a
 *  month/day difference within the same year — month and day only break ties, they
 *  never need to represent a real calendar length (no entry spans enough days for the
 *  31-day-month approximation to matter). */
export function dateKey({ year, month, day }) {
  return year * 372 + ((month ?? 1) - 1) * 31 + ((day ?? 1) - 1);
}

/**
 * Validates one country/language file's parsed YAML (`{ entries: [...] }`) and returns
 * the built entries, ready to serialise. Throws loudly, and early, on:
 *   - a duplicate id
 *   - an end date before its start date
 *   - a parent id that isn't itself an id in the same file
 *   - a missing tier (or one outside 1..5)
 *   - a missing name.bg
 * plus the other required-field and enum checks a hand-edited YAML file can get wrong.
 */
export function validateHistory(doc, where) {
  const entries = doc?.entries;
  if (!Array.isArray(entries)) throw new Error(`${where}: expected a top-level "entries" list`);

  const seenIds = new Set();
  const built = [];

  for (const [i, raw] of entries.entries()) {
    if (!raw || typeof raw !== 'object') throw new Error(`${where}: entries[${i}] is not a mapping`);
    if (!raw.id || !String(raw.id).trim()) throw new Error(`${where}: entries[${i}] is missing "id"`);
    const at = `${where}: "${raw.id}"`;

    if (seenIds.has(raw.id)) throw new Error(`${where}: duplicate id "${raw.id}"`);
    seenIds.add(raw.id);

    if (!KINDS.has(raw.kind)) throw new Error(`${at}: "kind" must be one of ${[...KINDS].join(', ')}, got ${JSON.stringify(raw.kind)}`);
    if (!raw.name?.bg || !String(raw.name.bg).trim()) throw new Error(`${at}: missing "name.bg"`);

    if (!Number.isInteger(raw.tier)) throw new Error(`${at}: missing or non-integer "tier"`);
    if (raw.tier < 1 || raw.tier > 5) throw new Error(`${at}: "tier" must be 1..5, got ${raw.tier}`);

    if (!PRECISIONS.has(raw.precision)) throw new Error(`${at}: "precision" must be one of ${[...PRECISIONS].join(', ')}, got ${JSON.stringify(raw.precision)}`);
    if (!STYLES.has(raw.style)) throw new Error(`${at}: "style" must be one of ${[...STYLES].join(', ')}, got ${JSON.stringify(raw.style)}`);

    if (raw.aliases !== undefined && !Array.isArray(raw.aliases)) throw new Error(`${at}: "aliases" must be a list`);
    if (raw.tags !== undefined && !Array.isArray(raw.tags)) throw new Error(`${at}: "tags" must be a list`);
    if (raw.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(raw.color)) throw new Error(`${at}: "color" must be a "#rrggbb" hex string`);

    if (raw.start === undefined || raw.start === null || raw.start === '') throw new Error(`${at}: missing "start"`);
    const start = parseHistoryDate(raw.start, `${at}: start`);
    const end = raw.end !== undefined && raw.end !== null && raw.end !== '' ? parseHistoryDate(raw.end, `${at}: end`) : null;
    if (end && dateKey(end) < dateKey(start)) {
      throw new Error(`${at}: end (${end.raw}) is before start (${start.raw})`);
    }

    built.push({
      id: String(raw.id),
      kind: raw.kind,
      name: { bg: String(raw.name.bg), en: String(raw.name.en ?? '') },
      aliases: (raw.aliases ?? []).map(String),
      role: raw.role != null ? String(raw.role) : null,
      start: start.raw,
      end: end ? end.raw : null,
      startYear: start.year,
      endYear: end ? end.year : null,
      precision: raw.precision,
      style: raw.style,
      tier: raw.tier,
      parent: raw.parent != null ? String(raw.parent) : null,
      category: raw.category != null ? String(raw.category) : null,
      tags: (raw.tags ?? []).map(String),
      color: raw.color != null ? String(raw.color) : null,
      blurb: { bg: String(raw.blurb?.bg ?? ''), en: String(raw.blurb?.en ?? '') }
    });
  }

  for (const entry of built) {
    if (entry.parent && !seenIds.has(entry.parent)) {
      throw new Error(`${where}: "${entry.id}" has unknown parent "${entry.parent}"`);
    }
  }

  return built;
}
