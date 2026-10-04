/**
 * Content QA for content/history/*.yaml, run against the BUILT output
 * (public/data/history/*.json — run `npm run build:content` first if bg.yaml changed).
 * Prints a report and changes NOTHING; a human decides every case, same spirit as
 * scripts/audit-freshness.mjs.
 *
 *   node scripts/check-history.mjs
 *
 * Five checks, each best-effort rather than a hard rule (a real history has legitimate
 * gaps and overlaps — this flags candidates for a human to look at, not violations):
 *   1. an entry whose dates fall outside its parent's period
 *   2. more than three entries of the same kind overlapping at any moment
 *   3. any end date after today
 *   4. a ruler or government with a gap of more than 5 years to the next one of its kind
 *   5. an `elected` field that is not a boolean, or is set on anything but a ruler or
 *      government (it only feeds the fill-the-list quiz toggle)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHistoryDate, dateKey } from './lib/history.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'public', 'data', 'history');
const files = readdirSync(dataDir).filter(f => f.endsWith('.json'));
if (!files.length) throw new Error(`${dataDir}: no built history files — run npm run build:content first`);

const todayKey = dateKey(parseHistoryDate(new Date().toISOString().slice(0, 10), 'today'));

const line = '─'.repeat(78);

for (const file of files) {
  const code = basename(file, '.json');
  const { entries } = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
  const byId = new Map(entries.map(e => [e.id, e]));

  const startKey = e => dateKey(parseHistoryDate(e.start, `${code}: "${e.id}".start`));
  // `end: null` means "ongoing" for a period/ruler/government (matches
  // app/lib/history/catalog.server.ts's toTimelineEntry); for an event it's a single
  // moment, so it collapses to its own start rather than reading as "ongoing forever".
  const endKey = e => {
    if (e.end != null) return dateKey(parseHistoryDate(e.end, `${code}: "${e.id}".end`));
    return e.kind === 'event' ? startKey(e) : Infinity;
  };

  console.log(`${line}\nHISTORY CHECK — ${code} (${entries.length} entries)\n${line}`);

  /* --------------------------------------------------------- 1. outside parent's period */
  const outsideParent = [];
  for (const e of entries) {
    if (!e.parent) continue;
    const parent = byId.get(e.parent);
    if (!parent) continue; // build already guarantees the id exists; not this script's job
    if (startKey(e) < startKey(parent) || endKey(e) > endKey(parent)) {
      const label = x => `${x.start}–${x.end ?? (x.kind === 'event' ? x.start : 'ongoing')}`;
      outsideParent.push(`   ${e.id} (${label(e)}) outside parent ${parent.id} (${label(parent)})`);
    }
  }
  console.log(`\n1. Outside parent's period: ${outsideParent.length}`);
  outsideParent.forEach(m => console.log(m));

  /* ------------------------------------------------ 2. >3 same-kind entries overlapping */
  const overlaps = [];
  const kinds = [...new Set(entries.map(e => e.kind))];
  for (const kind of kinds) {
    const ofKind = entries.filter(e => e.kind === kind);
    // an "ongoing" period/ruler/government (endKey === Infinity) is still active today,
    // so it counts up to and including todayKey, never past it
    const events = ofKind.flatMap(e => [
      { t: startKey(e), delta: 1, id: e.id },
      { t: Math.min(endKey(e), todayKey), delta: -1, id: e.id }
    ]);
    // ends before starts at the same instant, so a closing entry doesn't inflate the count
    // at the exact point another one begins
    events.sort((a, b) => a.t - b.t || a.delta - b.delta);
    let active = 0;
    const activeIds = new Set();
    for (const ev of events) {
      if (ev.delta === 1) activeIds.add(ev.id);
      else activeIds.delete(ev.id);
      active += ev.delta;
      if (active > 3) {
        overlaps.push(`   ${kind}: ${active} overlapping at t=${ev.t} — ${[...activeIds].join(', ')}`);
      }
    }
  }
  console.log(`\n2. More than three same-kind entries overlapping: ${overlaps.length} instants`);
  overlaps.forEach(m => console.log(m));

  /* --------------------------------------------------------------- 3. end date after today */
  const future = entries.filter(e => e.end != null && endKey(e) > todayKey);
  console.log(`\n3. End date after today: ${future.length}`);
  future.forEach(e => console.log(`   ${e.id} (${e.kind}) ends ${e.end}`));

  /* ------------------------------------------------- 4. ruler/government gap > 5 years */
  const gaps = [];
  for (const kind of ['ruler', 'government']) {
    const ofKind = entries.filter(e => e.kind === kind).sort((a, b) => startKey(a) - startKey(b));
    for (let i = 0; i < ofKind.length - 1; i++) {
      const cur = ofKind[i];
      const next = ofKind[i + 1];
      if (cur.end == null) continue; // ongoing — no "next" gap to measure
      const gapYears = (startKey(next) - endKey(cur)) / 372; // dateKey's own year scale
      if (gapYears > 5) {
        gaps.push(`   ${kind}: ${cur.id} ends ${cur.end} -> ${next.id} starts ${next.start} (${gapYears.toFixed(1)}y gap)`);
      }
    }
  }
  console.log(`\n4. Ruler/government gap over 5 years to the next: ${gaps.length}`);
  gaps.forEach(m => console.log(m));

  /* ------------------------------------------------------------ 5. elected field sanity */
  const badElected = entries.filter(
    e => 'elected' in e && (typeof e.elected !== 'boolean' || (e.kind !== 'ruler' && e.kind !== 'government'))
  );
  console.log(`\n5. Bad "elected" field: ${badElected.length}`);
  badElected.forEach(e => console.log(`   ${e.id} (${e.kind}) elected=${JSON.stringify(e.elected)}`));

  /* ------------------------------------------- 6. name / blurb empty in both languages */
  const has = t => ['bg', 'en'].some(l => t?.[l] && String(t[l]).trim());
  const noText = entries.filter(e => !has(e.name) || !has(e.blurb));
  console.log(`\n6. Missing name or blurb (needs bg or en, not both): ${noText.length}`);
  noText.forEach(e => console.log(`   ${e.id}: name ${has(e.name) ? 'ok' : 'EMPTY'}, blurb ${has(e.blurb) ? 'ok' : 'EMPTY'}`));

  console.log(`\n${line}\nnothing was changed — this is a report only\n${line}\n`);
}
