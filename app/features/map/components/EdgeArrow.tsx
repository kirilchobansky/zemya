/** The big chevron on a collapsed sidebar's expand tab. */
export function EdgeArrow({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'right' ? 'M9 4l8 8-8 8' : 'M15 4l-8 8 8 8'} />
    </svg>
  );
}
