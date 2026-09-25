/**
 * One-off import: content/history/events-bg.json (613 auto-generated events, bg-only,
 * flat era/category keys) -> content/history/bg.yaml (this project's hand-authored
 * schema, validated by scripts/lib/history.mjs). Run once; re-running is safe but will
 * throw on the id collisions it creates the first time (see DUPLICATE_JSON_IDS below) —
 * this is intentionally not idempotent, it's a migration, not a sync.
 *
 *   node scripts/import-events.mjs
 *
 * What it does, in order:
 *  1. Adds era colours to the 8 existing periods and inserts a new "pre" period
 *     (632-680, Стара Велика България — the JSON has no matching entry in bg.yaml yet).
 *  2. Updates the blurb.bg of the 17 existing tier-1 events that have a clean 1:1 match
 *     in the JSON, with the JSON's richer summary (see BLURB_UPDATES).
 *  3. Appends every other JSON event as a new kind: event entry, carrying two new
 *     optional schema fields — category (the JSON category key) and tags (its tag list)
 *     — plus color, adopted from the category's JSON colour (so an event's dot/marker
 *     colour needs no separate lookup at render time).
 *
 * Field mapping (event -> bg.yaml entry), per the import spec:
 *   name.bg    <- title            blurb.bg  <- summary
 *   tier       <- 4 - importance   (3->1, 2->2, 1->3)
 *   start      <- year, plus "-MM-DD" when both month and day are known (the shared
 *                 date parser in scripts/lib/history.mjs only accepts YYYY or
 *                 YYYY-MM-DD, never YYYY-MM, so a month with no day is dropped — the
 *                 JSON has 58 such events, all pre-modern)
 *   precision  <- exact when iso is set, else year
 *   style      <- old before 1 April 1916, new on/after (only two 1916 events exist in
 *                 the JSON and both carry exact post-April dates, so a same-year edge
 *                 case never has to be decided here)
 *   parent     <- the bg.yaml period id for the event's era (ERA_TO_PERIOD); "principality"
 *                 and "kingdom" both fold into period-principality-kingdom, which already
 *                 spans 1878-1946 as one period
 *   id         <- a slug of the title (Cyrillic transliterated), "event-" prefixed; on
 *                 collision with any id already used in the file (or generated earlier
 *                 in this run), the year is appended
 *
 * Deliberately out of scope: no English text. The JSON is bg-only, so name.en and
 * blurb.en are left "" for every imported entry, same as the schema comment in bg.yaml
 * already allows ("both keys always present, en may be empty").
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsonPath = join(root, 'content', 'history', 'events-bg.json');
const yamlPath = join(root, 'content', 'history', 'bg.yaml');

const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
let yamlText = readFileSync(yamlPath, 'utf8');
const doc = parse(yamlText);

const existingIds = new Set(doc.entries.map(e => String(e.id)));

// -- era / category colour lookups, straight from the JSON --------------------------
const eraColor = Object.fromEntries(data.eras.map(e => [e.id, e.color]));
const categoryColor = Object.fromEntries(data.categories.map(c => [c.id, c.color]));

// -- era key -> bg.yaml period id -----------------------------------------------------
const ERA_TO_PERIOD = {
  pre: 'period-pre',
  first: 'period-first-empire',
  byzantine: 'period-byzantine-rule',
  second: 'period-second-empire',
  ottoman: 'period-ottoman-rule',
  revival: 'period-vazrazhdane',
  principality: 'period-principality-kingdom',
  kingdom: 'period-principality-kingdom',
  communist: 'period-peoples-republic',
  republic: 'period-republic'
};

// Colour applied to each period band. Two JSON eras (principality, kingdom) collapse
// into the one period-principality-kingdom bg.yaml already has; it takes the earlier
// era's colour (principality, #4a6b8a) since a period can only carry one colour.
const periodColor = {};
for (const [era, periodId] of Object.entries(ERA_TO_PERIOD)) {
  if (!(periodId in periodColor)) periodColor[periodId] = eraColor[era];
}

// -- the 19 existing tier-1 events, matched by hand against the JSON (year + title) --
// Two of the 19 are hand-written composites covering two JSON events each (the national
// catastrophes entry = Bucharest 1913 + Neuilly 1919; the NATO/EU entry = accession
// 2004 + 2007) — both JSON halves are dropped as duplicates, but neither's summary
// replaces the composite blurb, since no single JSON summary covers both halves.
const BLURB_UPDATES = {
  6: 'event-founding',
  43: 'event-christianization',
  49: 'event-cyril-methodius-disciples',
  87: 'event-fall-first-empire',
  102: 'event-asen-petar-uprising',
  121: 'event-klokotnitsa',
  169: 'event-fall-vidin',
  196: 'event-istoriya-slavyanobalgarska',
  263: 'event-april-uprising',
  278: 'event-treaty-san-stefano',
  281: 'event-treaty-berlin',
  301: 'event-unification',
  348: 'event-independence',
  425: 'event-rescue-of-jews',
  432: 'event-coup-1944',
  511: 'event-fall-zhivkov',
  606: 'event-euro-adoption'
};
const DUPLICATE_JSON_IDS = new Set([
  ...Object.keys(BLURB_UPDATES).map(Number),
  362, 378, // national catastrophes (Bucharest, Neuilly)
  556, 562  // NATO / EU accession
]);

// -- helpers ---------------------------------------------------------------------------

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya'
};

function slugify(title) {
  const translit = [...title.toLowerCase()].map(ch => TRANSLIT[ch] ?? ch).join('');
  return translit
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function makeId(title, year) {
  const base = `event-${slugify(title)}`;
  let id = base;
  if (existingIds.has(id)) id = `${base}-${year}`;
  if (existingIds.has(id)) throw new Error(`id collision even after appending year: ${id}`);
  existingIds.add(id);
  return id;
}

function isOldStyle(year, month, day) {
  if (year !== 1916) return year < 1916;
  const m = month ?? 1;
  if (m !== 4) return m < 4;
  return (day ?? 1) < 1;
}

function yamlQuote(str) {
  return `"${String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function eventStart(e) {
  return e.month && e.day
    ? `${e.year}-${String(e.month).padStart(2, '0')}-${String(e.day).padStart(2, '0')}`
    : String(e.year);
}

function renderEvent(e) {
  const id = makeId(e.title, e.year);
  const start = eventStart(e);
  const precision = e.iso ? 'exact' : 'year';
  const style = isOldStyle(e.year, e.month, e.day) ? 'old' : 'new';
  const parent = ERA_TO_PERIOD[e.era];
  if (!parent) throw new Error(`event ${e.id} "${e.title}": unknown era "${e.era}"`);
  const color = categoryColor[e.category];
  const tags = e.tags.map(t => yamlQuote(t)).join(', ');

  return [
    `  - id: ${id}`,
    `    kind: event`,
    `    name: { bg: ${yamlQuote(e.title)}, en: "" }`,
    `    aliases: []`,
    `    start: ${yamlQuote(start)}`,
    `    precision: ${precision}`,
    `    style: ${style}`,
    `    tier: ${4 - e.importance}`,
    `    parent: ${parent}`,
    `    category: ${e.category}`,
    `    tags: [${tags}]`,
    `    color: ${yamlQuote(color)}`,
    `    blurb:`,
    `      bg: ${yamlQuote(e.summary)}`,
    `      en: ""`
  ].join('\n');
}

// -- 1. period colours + the new "pre" period ------------------------------------------

for (const [periodId, color] of Object.entries(periodColor)) {
  if (periodId === 'period-pre') continue; // doesn't exist yet, added below
  const re = new RegExp(`(id: ${periodId}[\\s\\S]*?\\n    tier: \\d\\n)`);
  if (!re.test(yamlText)) throw new Error(`period "${periodId}" not found in bg.yaml`);
  yamlText = yamlText.replace(re, `$1    color: ${yamlQuote(color)}\n`);
}

if (!existingIds.has('period-pre')) {
  const preEra = data.eras.find(e => e.id === 'pre');
  const preBlock = [
    `  - id: period-pre`,
    `    kind: period`,
    `    name: { bg: ${yamlQuote(preEra.name)}, en: "" }`,
    `    aliases: []`,
    `    start: "${preEra.start}"`,
    `    end: "${preEra.end}"`,
    `    precision: year`,
    `    style: old`,
    `    tier: 1`,
    `    color: ${yamlQuote(preEra.color)}`,
    `    blurb:`,
    `      bg: ${yamlQuote(preEra.desc)}`,
    `      en: ""`
  ].join('\n');

  const firstEmpireStart = /(  - id: period-first-empire\n)/;
  if (!firstEmpireStart.test(yamlText)) throw new Error('period-first-empire not found in bg.yaml');
  yamlText = yamlText.replace(firstEmpireStart, `${preBlock}\n\n$1`);
  existingIds.add('period-pre');
}

// -- 2. blurb updates on the 17 clean duplicates ----------------------------------------

for (const [jsonId, bgId] of Object.entries(BLURB_UPDATES)) {
  const event = data.events.find(e => e.id === Number(jsonId));
  if (!event) throw new Error(`JSON event id ${jsonId} not found`);
  const re = new RegExp(`(id: ${bgId}[\\s\\S]*?blurb:\\n {6}bg: )"[^"]*"`);
  if (!re.test(yamlText)) throw new Error(`event "${bgId}" not found in bg.yaml`);
  yamlText = yamlText.replace(re, `$1${yamlQuote(event.summary)}`);
}

// -- 3. append every non-duplicate event -------------------------------------------------

const toImport = data.events.filter(e => !DUPLICATE_JSON_IDS.has(e.id));
const blocks = toImport.map(renderEvent);

yamlText = yamlText.replace(/\n$/, '');
yamlText += '\n\n  # ---------------------------------------- imported events (scripts/import-events.mjs)\n';
yamlText += blocks.join('\n\n');
yamlText += '\n';

writeFileSync(yamlPath, yamlText, 'utf8');

console.log(`periods coloured   ${Object.keys(periodColor).length}`);
console.log(`period-pre added   ${existingIds.has('period-pre')}`);
console.log(`blurbs updated     ${Object.keys(BLURB_UPDATES).length}`);
console.log(`duplicates dropped ${DUPLICATE_JSON_IDS.size}`);
console.log(`events imported    ${toImport.length}`);
