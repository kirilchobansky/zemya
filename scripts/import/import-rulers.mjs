/**
 * One-off import: content/history/source-bg.html's ruler/government tables ->
 * content/history/bg.yaml (this project's hand-authored schema, validated by
 * scripts/lib/history.mjs). Run once; re-running is safe (it re-derives from the
 * source, and throws on any id collision) but not idempotent against a bg.yaml that
 * has since been hand-edited around the inserted sections.
 *
 *   node scripts/import/import-rulers.mjs
 *
 * Tables imported, each parsed straight out of the HTML (regex, not transcribed by
 * hand) with per-item tier/precision/skip decisions layered on top as data (OVERRIDES,
 * SKIP below) — those judgement calls aren't in the source and can't be parsed out of
 * it:
 *   4.3  Владетелите на Второто царство       -> kind: ruler,      role: цар
 *   8.5  Монарсите на Третото българско царство -> kind: ruler,    role: княз | цар
 *   9.3  Кой всъщност управлява 1946-1989, three parallel columns:
 *          БКП leader   -> kind: ruler,      role: лидер на БКП
 *          глава на държавата -> kind: ruler, role: държавен глава
 *          министър-председател -> kind: government
 *   7.4  Правителствата 1879-1908            -> kind: government
 *   8.6  Правителствата 1911-1946            -> kind: government
 *
 * Tier rule (owner instruction, not derivable from the source): 1 for Иван Асен II,
 * Калоян, Фердинанд I, Борис III and every Живков entry; 2 for other monarchs and
 * party leaders; 3 for short/contested reigns, figurehead heads-of-state and cabinets.
 *
 * Two 9.3 cells duplicate entries already in bg.yaml at finer precision and are
 * skipped (SKIP below): Kimon Georgiev's 1944-1946 governments (already two exact-dated
 * entries from table 8.6) and Georgi Atanasov's 1986-1990 premiership (already
 * pm-atanasov, table 11.3).
 *
 * This file is only the entry point; the helpers, table extraction, one module per source table
 * group and the bg.yaml splice live in scripts/import/rulers/.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIdMaker } from './rulers/helpers.mjs';
import { importSecondEmpire } from './rulers/second-empire.mjs';
import { importGovernments, importMonarchs } from './rulers/governments.mjs';
import { importCommunist } from './rulers/communist.mjs';
import { splice } from './rulers/splice.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const htmlPath = join(root, 'content', 'history', 'source-bg.html');
const yamlPath = join(root, 'content', 'history', 'bg.yaml');

const html = readFileSync(htmlPath, 'utf8');
const makeId = createIdMaker(readFileSync(yamlPath, 'utf8'));

const bySection = { second_empire: [], gov_1879_1908: [], monarchs_1879_1946: [], gov_1911_1946: [], communist: [] };

// the order matters: makeId suffixes a collision with the next free number
importSecondEmpire(html, makeId, bySection.second_empire);
importGovernments(html, makeId, '7.4 Правителствата 1879–1908', bySection.gov_1879_1908);
importGovernments(html, makeId, '8.6 Правителствата 1911–1946', bySection.gov_1911_1946);
importMonarchs(html, makeId, bySection.monarchs_1879_1946);
importCommunist(html, makeId, bySection.communist);

const { yamlText, sectioned } = splice(readFileSync(yamlPath, 'utf8'), bySection);
writeFileSync(yamlPath, yamlText, 'utf8');

for (const [header, entries] of sectioned) console.log(`${header.trim()}: ${entries.length}`);
