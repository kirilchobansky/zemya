/**
 * The categorical overlay palettes and the CSS tokens each entry is re-read from (see
 * overlays.ts's refreshOverlayColours, which overwrites these objects IN PLACE — they must stay
 * mutable `const`s with one identity, never be re-exported as copies).
 */

/** Sequential, teal to brass. Six bins because more than that stops being readable. */
export const DENSITY_RAMP = ['#123846', '#1B5566', '#37757D', '#7F9260', '#C69B45', '#F0B454'];
export const DENSITY_BREAKS = [5, 16, 50, 125, 400];
export const DENSITY_TOKENS = ['--density-1', '--density-2', '--density-3', '--density-4', '--density-5', '--density-6'];

export const LANGUAGE_COLOURS: Record<string, string> = {
  'Indo-European': '#4EA9C9',
  'Afro-Asiatic': '#E8A33D',
  'Sino-Tibetan': '#E2544F',
  'Niger-Congo': '#3DD68C',
  Austronesian: '#B98CE0',
  Turkic: '#F0D264',
  Austroasiatic: '#6FBF73',
  'Tai-Kadai': '#E0855A',
  'Japonic / Koreanic': '#7FA8F0',
  Uralic: '#C0D06A',
  'Other families': '#6B8494'
};
export const LANGUAGE_TOKENS: Record<string, string> = {
  'Indo-European': '--sea',
  'Afro-Asiatic': '--brass',
  'Sino-Tibetan': '--new',
  'Niger-Congo': '--master',
  Austronesian: '--categorical-violet',
  Turkic: '--categorical-gold',
  Austroasiatic: '--categorical-green',
  'Tai-Kadai': '--categorical-terracotta',
  'Japonic / Koreanic': '--categorical-blue',
  Uralic: '--categorical-olive',
  'Other families': '--categorical-slate'
};

export const RELIGION_COLOURS: Record<string, string> = {
  Christianity: '#4EA9C9',
  Islam: '#3DD68C',
  Hinduism: '#E8A33D',
  Buddhism: '#E0855A',
  Judaism: '#B98CE0',
  'Folk / traditional': '#C0D06A',
  'Secular / none': '#8FA3B0',
  Other: '#6B8494'
};
export const RELIGION_TOKENS: Record<string, string> = {
  Christianity: '--sea',
  Islam: '--master',
  Hinduism: '--brass',
  Buddhism: '--categorical-terracotta',
  Judaism: '--categorical-violet',
  'Folk / traditional': '--categorical-olive',
  'Secular / none': '--categorical-grey',
  Other: '--categorical-slate'
};

export const REGION_COLOURS: Record<string, string> = {
  Africa: '#E8A33D',
  Asia: '#E2544F',
  Europe: '#4EA9C9',
  Americas: '#3DD68C',
  Oceania: '#B98CE0'
};
export const REGION_TOKENS: Record<string, string> = {
  Africa: '--brass',
  Asia: '--new',
  Europe: '--sea',
  Americas: '--master',
  Oceania: '--categorical-violet'
};
