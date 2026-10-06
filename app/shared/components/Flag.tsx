/**
 * A country flag, rendered from the local SVGs in public/flags/ (generated from
 * svg-country-flags at build time — see scripts/build-content.mjs, which now also
 * injects width/height onto the SVG's root element from its viewBox). Falls back to the
 * emoji flag on error: offline, or before the service worker exists to cache the SVG, a
 * broken-image icon must never be what a learner sees.
 *
 * Sized from the country's own flagRatio rather than assumed 4:3 — Qatar is 2.55:1, Nepal
 * isn't even a rectangle, Switzerland and the Vatican are square. Both the rendered width
 * AND height are computed here, in JS, as a "contain" fit inside `size`'s bounding box —
 * deliberately not `width: auto` / `height: auto` plus CSS `aspect-ratio`, which renders
 * every flag at zero height the moment the source SVG has no intrinsic size of its own
 * (confirmed by looking: that is exactly what shipped before this comment was written).
 * Two explicit pixel numbers can't collapse to zero regardless of what the source file
 * does or does not declare. See CLAUDE.md's Quizzes section.
 */
import { useState } from 'react';

/** Bounding box a flag fits inside, in CSS px. A typical ~3:2-ish flag ends up close to
 *  the size flags always rendered at; a genuinely different shape (Qatar, Nepal, a
 *  square) sizes down from there rather than being stretched or letterboxed. */
const BOXES = {
  sm: { width: 20, height: 15 },
  md: { width: 64, height: 48 },
  lg: { width: 220, height: 165 },
  /** The "Name the Flag" quiz's own full-stage presentation — big enough that Qatar's
   *  sliver and Nepal's pennant both read clearly. */
  xl: { width: 460, height: 300 }
} as const;

export type FlagSize = keyof typeof BOXES;

interface FlagProps {
  iso2: string;
  emoji: string;
  /** Width / height of this flag's own viewBox — see scripts/build-content.mjs. */
  flagRatio: number;
  size?: FlagSize;
  /** Decorative by default. Pass an explicit '' in quiz contexts too — see Flag.tsx notes
   *  in the quiz generators: naming the country in alt text would make the answer
   *  readable by a screen reader or anyone hovering the DOM. */
  alt?: string;
}

/** The largest width/height that fits `ratio` inside `box` without exceeding either
 *  dimension — the same "contain" result `object-fit: contain` would give, computed
 *  ahead of time as two plain numbers so the element never depends on the browser's
 *  replaced-element auto-sizing algorithm at all. */
function containFit(ratio: number, box: { width: number; height: number }): { width: number; height: number } {
  const boxRatio = box.width / box.height;
  return ratio > boxRatio
    ? { width: box.width, height: box.width / ratio }
    : { width: box.height * ratio, height: box.height };
}

export function Flag({ iso2, emoji, flagRatio, size = 'md', alt = '' }: FlagProps) {
  const [broken, setBroken] = useState(false);
  const box = BOXES[size];

  if (broken) {
    return (
      <span className="flag flag--emoji" data-size={size} style={{ fontSize: box.width * 0.7 }}>
        {emoji}
      </span>
    );
  }

  const { width, height } = containFit(flagRatio, box);

  return (
    <img
      className="flag"
      data-size={size}
      style={{ width, height }}
      src={`/flags/${iso2.toLowerCase()}.svg`}
      loading="lazy"
      alt={alt}
      onError={() => setBroken(true)}
    />
  );
}
