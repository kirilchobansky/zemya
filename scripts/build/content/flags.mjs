import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { require, root } from './config.mjs';

/** Writes public/flags/<iso2>.svg for every country (override or upstream, sized from its viewBox),
 *  sets each record's flagRatio, removes orphans. */
export function buildFlags(countries) {
  // Committed alongside public/data/, not fetched from svg-country-flags at runtime — the
  // app must work offline and no third party should see which flag a browser just
  // requested. svg-country-flags (not flag-icons) ships each flag at its own true aspect
  // ratio instead of normalising everything to 4:3 — see CLAUDE.md's Quizzes section.
  const flagsSrcDir = join(dirname(require.resolve('svg-country-flags/package.json')), 'svg');
  const flagsOutDir = join(root, 'public', 'flags');
  mkdirSync(flagsOutDir, { recursive: true });

  const byIso2 = new Map(countries.map(c => [c.iso2.toLowerCase(), c]));
  const wantedFlags = new Set(byIso2.keys());
  const missingFlags = [...wantedFlags].filter(iso2 => !existsSync(join(flagsSrcDir, `${iso2}.svg`)));
  if (missingFlags.length) {
    throw new Error(`svg-country-flags has no flag for: ${missingFlags.join(', ')}`);
  }

  /** Every one of these SVGs' root `<svg>` element carries only a `viewBox`, no width/height
   *  attributes (confirmed: 0/197 have one). Throws rather than silently skipping a file,
   *  which is the bug this exists to prevent. */
  function viewBoxSize(svg, iso2) {
    const match = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
    if (!match) throw new Error(`flags: ${iso2}.svg has no viewBox to size it from`);
    const parts = match[1].trim().split(/[\s,]+/).map(Number);
    const [, , w, h] = parts;
    if (parts.length !== 4 || !(w > 0) || !(h > 0)) {
      throw new Error(`flags: ${iso2}.svg has an unparseable viewBox "${match[1]}"`);
    }
    return { w, h };
  }

  /**
   * An <img> with no intrinsic size at all computes to zero height with width/height left
   * auto, no matter what CSS aspect-ratio says — aspect-ratio needs one definite dimension
   * to resolve against, and a bare `viewBox` gives the element neither a natural size nor,
   * in practice, a reliably-honoured natural ratio. Confirmed by looking: every flag
   * rendered invisible until this existed. The fix has to be in the file itself, so every
   * place a flag is used gets a real intrinsic size for free — inject width/height from the
   * viewBox onto the root `<svg>` before writing it to public/flags/, rather than leaving
   * each caller to work around a sizeless image. flagRatio is still emitted on the country
   * record too (Flag.tsx wants a definite number, not a re-parsed viewBox, to size from).
   */
  function withIntrinsicSize(svg, w, h, iso2) {
    // The FIRST <svg ...> tag only — some flags (Slovenia's coat of arms) embed a second,
    // nested <svg> deeper in the file that legitimately has its own width/height. Checking
    // (or injecting into) anywhere-in-the-string would false-positive on that nested tag
    // and leave the actual root element still sizeless — confirmed: this is exactly what
    // happened to si.svg before the check was scoped to the root tag specifically.
    const rootTag = svg.match(/<svg\b[^>]*>/);
    if (!rootTag) throw new Error(`flags: ${iso2}.svg has no <svg> root element to size`);
    if (/\bwidth\s*=/.test(rootTag[0]) && /\bheight\s*=/.test(rootTag[0])) return svg;
    const injectedTag = rootTag[0].replace('<svg', `<svg width="${w}" height="${h}"`);
    return svg.slice(0, rootTag.index) + injectedTag + svg.slice(rootTag.index + rootTag[0].length);
  }

  /**
   * content/flags/<iso2>.svg replaces the upstream file, and content/flags/<iso2>.note.md says
   * why upstream is wrong. svg-country-flags mirrors Wikimedia and lags it (Syria's pre-2024
   * flag was still shipping in 2026). Same rule as the `override:` block on a country: this
   * closes an upstream gap and is never a place to express an opinion, so a file without a
   * note, a note without a file, or an override for a country that doesn't ship all fail the
   * build. The summary line lists the overrides so one that upstream has since fixed stays
   * visible and can be deleted.
   */
  const flagOverridesDir = join(root, 'content', 'flags');
  const flagOverrides = new Map(); // iso2 -> path of the replacement svg
  if (existsSync(flagOverridesDir)) {
    const where = 'content/flags';
    const files = readdirSync(flagOverridesDir);
    const stems = new Set();
    for (const file of files) {
      const m = file.match(/^([a-z]{2})\.(svg|note\.md)$/);
      if (!m) throw new Error(`${where}/${file}: expected <iso2>.svg or <iso2>.note.md (lower-case ISO 3166-1 alpha-2)`);
      stems.add(m[1]);
    }
    for (const iso2 of [...stems].sort()) {
      if (!wantedFlags.has(iso2)) {
        throw new Error(`${where}/${iso2}.*: "${iso2}" is not a shipped country — remove the override`);
      }
      if (!files.includes(`${iso2}.svg`)) {
        throw new Error(`${where}/${iso2}.note.md has no ${iso2}.svg beside it`);
      }
      const notePath = join(flagOverridesDir, `${iso2}.note.md`);
      if (!existsSync(notePath) || !readFileSync(notePath, 'utf8').trim()) {
        throw new Error(`${where}/${iso2}.svg needs a non-empty ${iso2}.note.md explaining why upstream is wrong`);
      }
      flagOverrides.set(iso2, join(flagOverridesDir, `${iso2}.svg`));
    }
  }

  for (const iso2 of wantedFlags) {
    const svgPath = flagOverrides.get(iso2) ?? join(flagsSrcDir, `${iso2}.svg`);
    const svg = readFileSync(svgPath, 'utf8');
    const { w, h } = viewBoxSize(svg, iso2);
    byIso2.get(iso2).flagRatio = w / h;
    writeFileSync(join(flagsOutDir, `${iso2}.svg`), withIntrinsicSize(svg, w, h, iso2), 'utf8');
  }

  // an orphan here would be a country that shipped once and no longer does — clean it up
  // rather than let public/flags/ grow forever
  let orphanedFlags = 0;
  for (const file of readdirSync(flagsOutDir)) {
    if (!wantedFlags.has(file.replace(/\.svg$/, ''))) {
      unlinkSync(join(flagsOutDir, file));
      orphanedFlags += 1;
    }
  }

  const flagsBytes = readdirSync(flagsOutDir)
    .reduce((sum, file) => sum + statSync(join(flagsOutDir, file)).size, 0);

  return { flagOverrides, wantedFlags, orphanedFlags, flagsBytes };
}
