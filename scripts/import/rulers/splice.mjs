/** Splices the five imported sections into bg.yaml text, chronologically, right after the First
 *  Empire rulers and before "heads of state since 1989"; drops the now-done TODO comment. */
export function splice(yamlText, bySection) {
  const sectioned = [
    ['  # ------------------------------------------ Second Empire rulers, 1185-1396 (table 4.3)', bySection.second_empire],
    ['  # --------------------------------------------- governments, 1879-1908 (table 7.4)', bySection.gov_1879_1908],
    ['  # ------------------------------------- monarchs, Third Bulgarian Kingdom (table 8.5)', bySection.monarchs_1879_1946],
    ['  # --------------------------------------------- governments, 1911-1946 (table 8.6)', bySection.gov_1911_1946],
    ['  # ----------------------------- communist-era power structure, 1946-1989 (table 9.3)', bySection.communist]
  ];

  let insertText = '';
  for (const [header, entries] of sectioned) {
    insertText += `${header}\n` + entries.join('\n\n') + '\n\n';
  }

  const anchor = '  # -------------------------------------------------- heads of state since 1989 (11.2)';
  if (!yamlText.includes(anchor)) throw new Error('insertion anchor not found in bg.yaml');
  yamlText = yamlText.replace(anchor, insertText.trimEnd() + '\n\n' + anchor);

  // -- drop the now-done TODO comment ------------------------------------------------------

  yamlText = yamlText.replace(
    /# TODO \(later pass, not this one\): Second Empire rulers[\s\S]*?parallel BKP-secretary \/ premier \/ head-of-state tracks\)\.\n#\n/,
    ''
  );
  if (/# TODO \(later pass, not this one\)/.test(yamlText)) throw new Error('TODO comment still present after replace');

  return { yamlText, sectioned };
}
