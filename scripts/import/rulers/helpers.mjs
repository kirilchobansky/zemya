/** Text, id and YAML helpers for the rulers import — same conventions as scripts/import/import-events.mjs. */
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya'
};

// existing ids spell ordinal rulers with an arabic digit (ruler-boris-1, ruler-petar-1),
// not a roman numeral, so new ids from this import follow the same convention
const ROMAN = { I: '1', II: '2', III: '3', IV: '4' };

export function slugify(name) {
  const arabic = name.split(' ').map(w => ROMAN[w] ?? w).join(' ');
  const translit = [...arabic.toLowerCase()].map(ch => TRANSLIT[ch] ?? ch).join('');
  return translit.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
}

/** Returns makeId(prefix, name): a unique id, suffixed -2, -3 ... against the ids already in bg.yaml. */
export function createIdMaker(yamlText) {
  const existingIds = new Set([...yamlText.matchAll(/^  - id: (\S+)/gm)].map(m => m[1]));
  return function makeId(prefix, name) {
    const base = `${prefix}-${slugify(name)}`;
    let id = base;
    let n = 2;
    while (existingIds.has(id)) id = `${base}-${n++}`;
    existingIds.add(id);
    return id;
  };
}

export function yamlQuote(str) {
  return `"${String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function stripTags(htmlFragment) {
  return htmlFragment
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** "5.07.1879" -> "1879-07-05"; also accepts the bare-year form used by table 4.3/8.5. */
export function toIsoDate(d, m, y) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const FULL_DATE_RE = /(\d{1,2})\.(\d{1,2})\.(\d{4})/;

/** old for any date before 1 April 1916 (Julian cutover), same rule as import-events.mjs;
 *  a range's style follows its start, same convention as the existing spanning periods
 *  (e.g. period-principality-kingdom, 1878-1946, is "old" though it runs past 1916). */
export function isOldStyle(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (y !== 1916) return y < 1916;
  const month = m ?? 1;
  if (month !== 4) return month < 4;
  return (d ?? 1) < 1;
}

/** Parses one "range" cell: either "1185–1197" (years) or "5.07.1879 – 26.11.1879"
 *  (full dates, en-dash separated, open-ended with just "16.01.1908 – "). */
export function parseRange(text) {
  const full = [...text.matchAll(new RegExp(FULL_DATE_RE, 'g'))];
  if (full.length >= 1) {
    const [, d1, m1, y1] = full[0];
    const start = toIsoDate(d1, m1, y1);
    if (full.length >= 2) {
      const [, d2, m2, y2] = full[1];
      return { start, end: toIsoDate(d2, m2, y2), precision: 'exact' };
    }
    return { start, end: null, precision: 'exact' };
  }
  const years = [...text.matchAll(/-?\d+/g)].map(m => m[0]);
  if (years.length === 0) throw new Error(`parseRange: no date found in "${text}"`);
  return { start: years[0], end: years[1] ?? null, precision: 'year' };
}

export function renderEntry({ id, kind, nameBg, nameEn, aliases = [], role, start, end, precision, style, tier, parent, blurbBg, blurbEn = '' }) {
  const lines = [
    `  - id: ${id}`,
    `    kind: ${kind}`,
    `    name: { bg: ${yamlQuote(nameBg)}, en: ${yamlQuote(nameEn)} }`,
    `    aliases: [${aliases.map(yamlQuote).join(', ')}]`,
    `    role: ${role}`,
    `    start: ${yamlQuote(start)}`
  ];
  if (end) lines.push(`    end: ${yamlQuote(end)}`);
  lines.push(`    precision: ${precision}`, `    style: ${style}`, `    tier: ${tier}`);
  if (parent) lines.push(`    parent: ${parent}`);
  lines.push(`    blurb:`, `      bg: ${yamlQuote(blurbBg)}`, `      en: ${yamlQuote(blurbEn)}`);
  return lines.join('\n');
}

