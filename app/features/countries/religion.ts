/**
 * Religion values sit at different levels of specificity, so "is this distractor a real
 * choice" needs a hierarchy. Used by religion-of questions (question-generators.ts) and by
 * the Name-all / search matching (names.ts, religionChain).
 */
/**
 * The religion values authored in content/ sit at different levels of specificity —
 * "Christianity" alongside "Roman Catholicism", "Protestantism (Anglican)", "Eastern
 * Orthodoxy"; "Islam" alongside "Sunni Islam", "Shia Islam". Plain value-dedup happily
 * offers a parent and its own child as two options ("Christianity" vs "Roman
 * Catholicism" is not a real choice). BROADER walks each specific value up to its root;
 * a distractor is rejected if it sits anywhere on the correct answer's chain in either
 * direction, and compound values ("Christianity / Sunni Islam") are split on " / " and
 * checked component by component, since either half clashing makes the whole pairing
 * unusable as a distractor. Applied only to religion-of — nothing else here has a
 * hierarchy.
 */
export const BROADER: Record<string, string> = {
  'Roman Catholicism': 'Christianity',
  'Protestantism': 'Christianity',
  'Protestantism (Anglican)': 'Protestantism',
  'Protestantism (Lutheran)': 'Protestantism',
  'Eastern Orthodoxy': 'Christianity',
  'Ethiopian Orthodoxy': 'Christianity',
  'Christianity (Armenian Apostolic)': 'Christianity',
  'Buddhism (Theravada)': 'Buddhism',
  'Buddhism (Vajrayana)': 'Buddhism',
  'Sunni Islam': 'Islam',
  'Shia Islam': 'Islam',
  'Ibadi Islam': 'Islam'
};

/** A value's chain from itself up to its root, inclusive — e.g. "Roman Catholicism" ->
 *  ["Roman Catholicism", "Christianity"]. */
export function religionChain(value: string): string[] {
  const chain = [value];
  let current = value;
  while (BROADER[current]) {
    current = BROADER[current];
    chain.push(current);
  }
  return chain;
}

function religionComponentsClash(a: string, b: string): boolean {
  const chainA = religionChain(a);
  const chainB = religionChain(b);
  return chainA.includes(b) || chainB.includes(a);
}

/** True if any component of `candidate` is an ancestor, descendant, or exact match of any
 *  component of `correct` — both split on " / " first, since a compound value is really
 *  several claims at once. */
export function religionsClash(correct: string, candidate: string): boolean {
  const correctParts = correct.split(' / ');
  const candidateParts = candidate.split(' / ');
  return correctParts.some(cp => candidateParts.some(dp => religionComponentsClash(cp, dp)));
}
