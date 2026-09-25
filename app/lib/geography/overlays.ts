/**
 * Choropleth overlays.
 *
 * Semantic colour (mastery) is kept separate from the categorical palettes, and both are
 * separate from the brass accent — a country coloured "Islam" on the religion overlay must
 * not read as "selected".
 */
import type { CountryRecord, Feature } from '~/lib/map/types';
import type { CountryMastery } from './mastery';

export type OverlayId =
  | 'terrain'
  | 'mastery'
  | 'density'
  | 'language'
  | 'religion'
  | 'region';

/**
 * Every colour below is resolved from app/styles/tokens.css: the values here are the dark
 * theme's defaults (kept in sync by hand, same convention as renderer.ts's COLORS), and
 * refreshOverlayColours() overwrites them from the live CSS custom properties once — at
 * app/routes/atlas.tsx's mount and on every theme change. A canvas fillStyle/strokeStyle
 * can't be `var(--x)`, which is what these feed via fillFor/strokeFor below.
 */
export let LAND = '#31485A';
export let SELECTED = '#E8A33D';
export let NEIGHBOUR = '#3F8FAB';
export let HOVER = '#456580';
let STROKE_SELECTED = '#F5CE86';
let STROKE_NEIGHBOUR = '#8FD3EA';
let STROKE_HOVER = '#7E9CB0';
let STROKE_DEFAULT = 'rgba(10,16,23,.92)';

/** Sequential, teal to brass. Six bins because more than that stops being readable. */
const DENSITY_RAMP = ['#123846', '#1B5566', '#37757D', '#7F9260', '#C69B45', '#F0B454'];
const DENSITY_BREAKS = [5, 16, 50, 125, 400];
const DENSITY_TOKENS = ['--density-1', '--density-2', '--density-3', '--density-4', '--density-5', '--density-6'];

const LANGUAGE_COLOURS: Record<string, string> = {
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
const LANGUAGE_TOKENS: Record<string, string> = {
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

const RELIGION_COLOURS: Record<string, string> = {
  Christianity: '#4EA9C9',
  Islam: '#3DD68C',
  Hinduism: '#E8A33D',
  Buddhism: '#E0855A',
  Judaism: '#B98CE0',
  'Folk / traditional': '#C0D06A',
  'Secular / none': '#8FA3B0',
  Other: '#6B8494'
};
const RELIGION_TOKENS: Record<string, string> = {
  Christianity: '--sea',
  Islam: '--master',
  Hinduism: '--brass',
  Buddhism: '--categorical-terracotta',
  Judaism: '--categorical-violet',
  'Folk / traditional': '--categorical-olive',
  'Secular / none': '--categorical-grey',
  Other: '--categorical-slate'
};

/**
 * The three mastery colours are semantic, not categorical: red / amber / green read as
 * "not yet", "in progress", "done" without a legend. They are the only overlay whose
 * colours carry a judgement, which is why they are kept out of the palettes above.
 */
export let MASTERY_COLOURS: Record<CountryMastery, string> = {
  new: '#E2544F',
  learning: '#E8A33D',
  mastered: '#3DD68C'
};

const REGION_COLOURS: Record<string, string> = {
  Africa: '#E8A33D',
  Asia: '#E2544F',
  Europe: '#4EA9C9',
  Americas: '#3DD68C',
  Oceania: '#B98CE0'
};
const REGION_TOKENS: Record<string, string> = {
  Africa: '--brass',
  Asia: '--new',
  Europe: '--sea',
  Americas: '--master',
  Oceania: '--categorical-violet'
};

/**
 * Re-reads every colour above from tokens.css and caches it in place — called once from
 * app/routes/atlas.tsx before the first frame and again on every theme change. Same reason
 * and convention as renderer.ts's refreshMapColours: a canvas frame can't call
 * getComputedStyle, so nothing here may run inside the render loop.
 */
export function refreshOverlayColours(): void {
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string) => cs.getPropertyValue(name).trim();

  LAND = read('--land');
  SELECTED = read('--brass');
  NEIGHBOUR = read('--neighbour');
  HOVER = read('--hover-fill');
  STROKE_SELECTED = read('--brass-2');
  STROKE_NEIGHBOUR = read('--neighbour-stroke');
  STROKE_HOVER = read('--hover-stroke');
  STROKE_DEFAULT = read('--border-default');

  DENSITY_TOKENS.forEach((token, i) => { DENSITY_RAMP[i] = read(token); });
  for (const key in LANGUAGE_TOKENS) LANGUAGE_COLOURS[key] = read(LANGUAGE_TOKENS[key]);
  for (const key in RELIGION_TOKENS) RELIGION_COLOURS[key] = read(RELIGION_TOKENS[key]);
  for (const key in REGION_TOKENS) REGION_COLOURS[key] = read(REGION_TOKENS[key]);

  MASTERY_COLOURS = { new: read('--new'), learning: read('--learn'), mastered: read('--master') };
}

function densityColour(density: number): string {
  if (!density) return DENSITY_RAMP[0];
  const index = DENSITY_BREAKS.findIndex(b => density < b);
  return DENSITY_RAMP[index === -1 ? DENSITY_RAMP.length - 1 : index];
}

export function overlayColour(overlay: OverlayId, country: CountryRecord): string {
  switch (overlay) {
    case 'density':
      return densityColour(country.density);
    case 'language':
      return LANGUAGE_COLOURS[country.languageFamily] ?? LANGUAGE_COLOURS['Other families'];
    case 'religion':
      return RELIGION_COLOURS[country.religionGroup] ?? RELIGION_COLOURS.Other;
    case 'region':
      return REGION_COLOURS[country.region] ?? LAND;
    default:
      return LAND;
  }
}

export interface LegendEntry {
  colour: string;
  label: string;
}

export const OVERLAYS: { id: OverlayId; label: string }[] = [
  { id: 'terrain', label: 'Terrain' },
  { id: 'mastery', label: 'Mastery' },
  { id: 'density', label: 'Density' },
  { id: 'language', label: 'Language' },
  { id: 'religion', label: 'Religion' },
  { id: 'region', label: 'Region' }
];

export function legendFor(overlay: OverlayId): { title: string; entries: LegendEntry[] } {
  switch (overlay) {
    case 'mastery':
      return {
        title: 'What you know',
        entries: [
          { colour: MASTERY_COLOURS.mastered, label: 'Mastered' },
          { colour: MASTERY_COLOURS.learning, label: 'Learning' },
          { colour: MASTERY_COLOURS.new, label: 'New / not yet seen' }
        ]
      };
    case 'density':
      return {
        title: 'People per km²',
        entries: [
          { colour: DENSITY_RAMP[0], label: 'under 5' },
          { colour: DENSITY_RAMP[1], label: '5 – 16' },
          { colour: DENSITY_RAMP[2], label: '16 – 50' },
          { colour: DENSITY_RAMP[3], label: '50 – 125' },
          { colour: DENSITY_RAMP[4], label: '125 – 400' },
          { colour: DENSITY_RAMP[5], label: 'over 400' }
        ]
      };
    case 'language':
      return {
        title: 'Language family',
        entries: Object.entries(LANGUAGE_COLOURS).map(([label, colour]) => ({ label, colour }))
      };
    case 'religion':
      return {
        title: 'Predominant faith',
        entries: Object.entries(RELIGION_COLOURS).map(([label, colour]) => ({ label, colour }))
      };
    case 'region':
      return {
        title: 'Continent',
        entries: Object.entries(REGION_COLOURS).map(([label, colour]) => ({ label, colour }))
      };
    default:
      return {
        title: 'Selection',
        entries: [
          { colour: SELECTED, label: 'Selected country' },
          { colour: NEIGHBOUR, label: 'Shares a land border' },
          { colour: LAND, label: 'Everything else' }
        ]
      };
  }
}

export interface StyleInputs {
  overlay: OverlayId;
  selected: Feature | null;
  hovered: Feature | null;
  showNeighbours: boolean;
  /**
   * Supplied by the caller rather than read here, because mastery depends on the progress
   * store and this module must stay a pure colour function the renderer can call per
   * country, per frame.
   */
  masteryOf(country: CountryRecord): CountryMastery;
}

/** Fill resolution, in priority order: selection beats hover beats the overlay. */
export function fillFor(feature: Feature, s: StyleInputs): string {
  if (s.selected === feature) return SELECTED;
  if (s.showNeighbours && s.selected?.neighbours.includes(feature)) return NEIGHBOUR;
  if (s.hovered === feature) return HOVER;
  if (s.overlay === 'mastery') return MASTERY_COLOURS[s.masteryOf(feature.country)];
  return overlayColour(s.overlay, feature.country);
}

export function strokeFor(feature: Feature, s: StyleInputs): [string, number] {
  if (s.selected === feature) return [STROKE_SELECTED, 1.8];
  if (s.showNeighbours && s.selected?.neighbours.includes(feature)) return [STROKE_NEIGHBOUR, 1.2];
  if (s.hovered === feature) return [STROKE_HOVER, 1.2];
  return [STROKE_DEFAULT, 1];
}

/**
 * Live state of a "Name the Country" run, read by quizFillFor/quizStrokeFor every frame.
 * `answered` is keyed by iso3 rather than by Feature so it survives independently of
 * whatever object identity a re-fetched world happens to have.
 */
export interface QuizOverride {
  /** The country currently being asked about, highlighted in brass. Null before START
   *  and during the results screen. */
  target: Feature | null;
  /** Every country answered so far this run, and how — stays filled for the rest of the
   *  run once set (see CLAUDE.md's Quizzes section). */
  answered: ReadonlyMap<string, 'correct' | 'revealed'>;
  /** Off by default, per the owner's explicit request — a manual toggle in the quiz HUD
   *  turns it on for the current target only. */
  showNeighbours: boolean;
  /** Mark the target country's capital with the quiz-target ring (the capitals quiz — see
   *  QuizDefinition.markCapital). atlas.tsx resolves it to the renderer's Style.quizPlace. */
  showCapital: boolean;
  /** True while the run is paused (Esc). Doesn't change fill/stroke — the map is blurred
   *  via a CSS class in app/routes/atlas.tsx instead — but travels with the rest of the
   *  quiz state since it's the same "what is this run doing right now" object. */
  paused: boolean;
}

/** Fill resolution during a quiz run: answered beats the current target beats the
 *  optional neighbour glow beats plain land. No overlay, no hover, no mastery — none of
 *  those apply mid-quiz and showing them would be one more thing to explain, not help. */
export function quizFillFor(feature: Feature, quiz: QuizOverride): string {
  const outcome = quiz.answered.get(feature.country.iso3);
  if (outcome === 'correct') return MASTERY_COLOURS.mastered;
  // red ("not known"), NOT amber: the target is brass and amber is the same value, so a revealed
  // country was indistinguishable from the question. Red is the mastery colour for "new".
  if (outcome === 'revealed') return MASTERY_COLOURS.new;
  if (quiz.target === feature) return SELECTED;
  if (quiz.showNeighbours && quiz.target?.neighbours.includes(feature)) return NEIGHBOUR;
  return LAND;
}

export function quizStrokeFor(feature: Feature, quiz: QuizOverride): [string, number] {
  if (quiz.target === feature) return [STROKE_SELECTED, 1.8];
  if (quiz.showNeighbours && quiz.target?.neighbours.includes(feature)) return [STROKE_NEIGHBOUR, 1.2];
  return [STROKE_DEFAULT, 1];
}
