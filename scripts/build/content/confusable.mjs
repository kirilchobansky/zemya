import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { root } from './config.mjs';

/**
 * A small curated list (content/geography/confusable-flags.yaml) of flag pairs the "Name
 * the Flag" quiz accepts for each other, with a factual note on the real difference — see
 * that file's own header comment and CLAUDE.md's Quizzes section for why this exists and
 * why it stays hand-curated rather than generated. Each side gets the OTHER country's
 * already-computed aliases embedded directly (denormalised), so
 * app/features/quizzes/geography/quizzes.ts's matcher can accept "that one was the twin" without a
 * second lookup into the full catalogue at match time.
 */
export function applyConfusableFlags(countries) {
  const confusableFlagsPath = join(root, 'content', 'geography', 'confusable-flags.yaml');
  const confusableDoc = parse(readFileSync(confusableFlagsPath, 'utf8')) ?? {};
  const countryByName = new Map(countries.map(c => [c.name, c]));
  let confusablePairCount = 0;
  for (const pair of confusableDoc.pairs ?? []) {
    const where = 'content/geography/confusable-flags.yaml';
    if (!Array.isArray(pair.countries) || pair.countries.length !== 2) {
      throw new Error(`${where}: each pair needs exactly two "countries"`);
    }
    if (!pair.note || !String(pair.note).trim()) {
      throw new Error(`${where}: pair "${pair.countries.join(' / ')}" needs a non-empty "note"`);
    }
    const [nameA, nameB] = pair.countries;
    const a = countryByName.get(nameA);
    const b = countryByName.get(nameB);
    if (!a) throw new Error(`${where}: "${nameA}" is not a known country name`);
    if (!b) throw new Error(`${where}: "${nameB}" is not a known country name`);
    const note = String(pair.note).trim();
    a.confusableFlag = { iso3: b.iso3, aliases: b.aliases, note };
    b.confusableFlag = { iso3: a.iso3, aliases: a.aliases, note };
    confusablePairCount += 1;
  }
  return confusablePairCount;
}
