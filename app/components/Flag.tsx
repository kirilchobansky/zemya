/**
 * A country flag, rendered from the local SVGs in public/flags/ (generated from
 * svg-country-flags at build time — see scripts/build-content.mjs). Falls back to the
 * emoji flag on error: offline, or before the service worker exists to cache the SVG, a
 * broken-image icon must never be what a learner sees.
 *
 * Sized from the country's own flagRatio rather than assumed 4:3 — Qatar is 2.55:1, Nepal
 * isn't even a rectangle, Switzerland and the Vatican are square. `size` is a bounding
 * box (max-width/max-height); the flag fits inside it at its true shape rather than being
 * stretched or letterboxed into a fixed 4:3 slot. See CLAUDE.md's Quizzes section.
 */
import { useState } from 'react';

/** Bounding box a flag fits inside, in CSS px — not the flag's own final size. Heights
 *  are derived at 4:3 (the shape most flags are actually close to) so a typical flag ends
 *  up exactly the size it always did; a genuinely different shape (Qatar, Nepal, a
 *  square) sizes down from there rather than being forced into this box. */
const BOXES = {
  sm: { width: 20, height: 15 },
  md: { width: 64, height: 48 },
  lg: { width: 220, height: 165 }
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

  return (
    <img
      className="flag"
      data-size={size}
      style={{ aspectRatio: flagRatio, maxWidth: box.width, maxHeight: box.height }}
      src={`/flags/${iso2.toLowerCase()}.svg`}
      loading="lazy"
      alt={alt}
      onError={() => setBroken(true)}
    />
  );
}
