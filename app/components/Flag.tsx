/**
 * A country flag, rendered from the local SVGs in public/flags/ (generated from
 * flag-icons at build time — see scripts/build-content.mjs). Falls back to the emoji
 * flag on error: offline, or before the service worker exists to cache the SVG, a
 * broken-image icon must never be what a learner sees.
 */
import { useState } from 'react';

const SIZES = {
  sm: 20,
  md: 64,
  lg: 220
} as const;

export type FlagSize = keyof typeof SIZES;

interface FlagProps {
  iso2: string;
  emoji: string;
  size?: FlagSize;
  /** Decorative by default. Pass an explicit '' in quiz contexts too — see Flag.tsx notes
   *  in the quiz generators: naming the country in alt text would make the answer
   *  readable by a screen reader or anyone hovering the DOM. */
  alt?: string;
}

export function Flag({ iso2, emoji, size = 'md', alt = '' }: FlagProps) {
  const [broken, setBroken] = useState(false);
  const px = SIZES[size];

  if (broken) {
    return (
      <span className="flag flag--emoji" data-size={size} style={{ fontSize: px * 0.7 }}>
        {emoji}
      </span>
    );
  }

  return (
    <img
      className="flag"
      data-size={size}
      style={{ width: px }}
      src={`/flags/${iso2.toLowerCase()}.svg`}
      loading="lazy"
      alt={alt}
      onError={() => setBroken(true)}
    />
  );
}
