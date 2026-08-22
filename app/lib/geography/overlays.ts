/**
 * Choropleth overlays.
 *
 * Semantic colour (mastery) is kept separate from the categorical palettes, and both are
 * separate from the brass accent — a country coloured "Islam" on the religion overlay must
 * not read as "selected".
 */
import type { CountryRecord, Feature } from '~/lib/map/types';

export type OverlayId = 'terrain' | 'density' | 'language' | 'religion' | 'region';

export const LAND = '#31485A';
export const SELECTED = '#E8A33D';
export const NEIGHBOUR = '#3F8FAB';
export const HOVER = '#456580';

/** Sequential, teal to brass. Six bins because more than that stops being readable. */
const DENSITY_RAMP = ['#123846', '#1B5566', '#37757D', '#7F9260', '#C69B45', '#F0B454'];
const DENSITY_BREAKS = [5, 16, 50, 125, 400];

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

const REGION_COLOURS: Record<string, string> = {
  Africa: '#E8A33D',
  Asia: '#E2544F',
  Europe: '#4EA9C9',
  Americas: '#3DD68C',
  Oceania: '#B98CE0'
};

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
  { id: 'density', label: 'Density' },
  { id: 'language', label: 'Language' },
  { id: 'religion', label: 'Religion' },
  { id: 'region', label: 'Region' }
];

export function legendFor(overlay: OverlayId): { title: string; entries: LegendEntry[] } {
  switch (overlay) {
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
}

/** Fill resolution, in priority order: selection beats hover beats the overlay. */
export function fillFor(feature: Feature, s: StyleInputs): string {
  if (s.selected === feature) return SELECTED;
  if (s.showNeighbours && s.selected?.neighbours.includes(feature)) return NEIGHBOUR;
  if (s.hovered === feature) return HOVER;
  return overlayColour(s.overlay, feature.country);
}

export function strokeFor(feature: Feature, s: StyleInputs): [string, number] {
  if (s.selected === feature) return ['#F5CE86', 1.8];
  if (s.showNeighbours && s.selected?.neighbours.includes(feature)) return ['#8FD3EA', 1.2];
  if (s.hovered === feature) return ['#7E9CB0', 1.2];
  return ['rgba(10,16,23,.92)', 1];
}
