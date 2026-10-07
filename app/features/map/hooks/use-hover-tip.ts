import { useCallback, useRef, useState } from 'react';

/** The hover tooltip's position: React state when it appears or changes country, then moved
 *  straight in the DOM while the pointer travels inside one country (no re-render per move). */
export function useHoverTip() {
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const movePointer = useCallback((x: number, y: number) => {
    const el = tipRef.current;
    if (!el) return;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, []);
  return { tip, tipRef, setTip, movePointer };
}
