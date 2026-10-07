/**
 * The canvas fonts of HistoryTimeline (timeline.ts): the CSS custom properties
 * --font-ui / --font-mono, read once up front and again when the webfonts settle.
 */
export interface CanvasFonts {
  ui: string;
  mono: string;
}

export const FALLBACK_FONTS: CanvasFonts = { ui: 'system-ui, sans-serif', mono: 'ui-monospace, monospace' };

/** The fonts the document currently resolves --font-ui / --font-mono to, falling back to
 *  `current` for whichever is unset (and outside a browser). */
export function readCanvasFonts(current: CanvasFonts): CanvasFonts {
  if (typeof getComputedStyle !== 'function') return current;
  return {
    ui: getComputedStyle(document.body).getPropertyValue('--font-ui') || current.ui,
    mono: getComputedStyle(document.body).getPropertyValue('--font-mono') || current.mono
  };
}

/** Cyrillic text (entry.label of a Bulgarian country) must not stay stuck on a Latin-only
 *  fallback: the values read at construction may be whatever --font-ui/--font-mono resolve
 *  to BEFORE the webfont (Archivo / IBM Plex Mono, both Cyrillic) has finished
 *  loading. document.fonts.ready resolves once loading settles either way — with the
 *  real webfont if it loaded, or confirming the fallback is what it's staying on if
 *  not (e.g. offline) — so re-reading the custom properties then and asking for one
 *  more render corrects a first paint that guessed wrong, without polling. */
export function onFontsSettled(callback: () => void): void {
  if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.ready.then(callback).catch(() => {});
  }
}
