/** Name normalisation shared by every alias check in the pipeline. */
/** Mirrors app/features/countries/names.ts's normaliseName() — kept in sync deliberately, the
 *  same way build-content.mjs's FACETS mirrors mastery.ts's, because this build script
 *  runs as plain Node and can't import a .ts module through the `~` alias. Unicode
 *  `\p{L}`/`\p{N}` matters here too: an ASCII a-z0-9 range would treat Armenian or
 *  Cyrillic aliases as pure punctuation and normalise every one of them to "", which
 *  would make every non-Latin alias in the catalogue collide with every other one. */
export function normaliseAlias(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’‘ʼ`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
