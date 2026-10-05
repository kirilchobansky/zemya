import { useEffect, useMemo, useRef, useState } from 'react';

import { Flag } from '~/components/Flag';
import { normalise } from '~/lib/format';
import { normaliseName } from '~/lib/geography/names';
import { BULGARIAN_NAMES } from '~/lib/geography/names-bg';
import { isCoarsePointer } from '~/lib/viewport';
import type { Feature, World } from '~/lib/map/types';

const MAX_RESULTS = 8;

interface SearchBoxProps {
  world: World | null;
  onPick(feature: Feature): void;
}

export function SearchBox({ world, onPick }: SearchBoxProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Pre-normalised once per payload; typing then costs one includes() per country. */
  const index = useMemo(() => {
    if (!world) return [];
    return world.features.map(feature => ({
      feature,
      name: normalise(feature.country.name),
      capital: normalise(feature.country.capital ?? ''),
      iso3: feature.country.iso3.toLowerCase(),
      /** other spellings the country answers to (English aliases, Bulgarian names): "Czech Republic",
       *  "Burma", "Чехия". Matched from the start only, so "republic" does not find half the list. */
      alts: [...new Set([...feature.country.aliases, ...(BULGARIAN_NAMES[feature.country.iso3] ?? [])].map(normaliseName).filter(Boolean))]
    }));
  }, [world]);

  const results = useMemo(() => {
    const q = normalise(query);
    const qAlt = normaliseName(query);
    if (!q && !qAlt) return [];
    const altHit = (e: (typeof index)[number]) => qAlt.length >= 2 && e.alts.some(a => a.startsWith(qAlt));
    const nameHit = (e: (typeof index)[number]) => q.length > 0 && e.name.includes(q);
    return index
      .filter(e => nameHit(e) || (q.length > 0 && (e.capital.includes(q) || e.iso3 === q)) || altHit(e))
      .sort((a, b) => {
        // a hit on the displayed name leads, then capital/code, then another spelling
        const byPosition = (nameHit(a) ? a.name.indexOf(q) : 1e3) - (nameHit(b) ? b.name.indexOf(q) : 1e3);
        if (byPosition !== 0) return byPosition;
        return b.feature.country.population - a.feature.country.population;
      })
      .slice(0, MAX_RESULTS)
      .map(e => e.feature);
  }, [index, query]);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  }, []);

  function choose(feature: Feature | undefined) {
    if (!feature) return;
    onPick(feature);
    setQuery('');
    setOpen(false);
    setActive(-1);
    // on a touch screen the keyboard has done its job; leaving it up would cover the map the
    // camera is about to fly to (and the pill would stay expanded)
    if (isCoarsePointer()) inputRef.current?.blur();
  }

  return (
    <div className="search" ref={wrapRef}>
      <span className="search__icon" aria-hidden="true">
        ⌕
      </span>
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="Search countries, capitals…"
        autoComplete="off"
        spellCheck={false}
        aria-label="Search countries"
        onChange={e => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (!results.length) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(results[Math.max(0, active)]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && query && (
        <div className="search__results glass" role="listbox">
          {results.length === 0 ? (
            <button type="button" disabled style={{ color: 'var(--ink-3)' }}>
              No match
            </button>
          ) : (
            results.map((feature, i) => (
              <button
                key={feature.country.iso3}
                type="button"
                role="option"
                aria-selected={i === active}
                data-active={i === active}
                onClick={() => choose(feature)}
              >
                <Flag
                  iso2={feature.country.iso2}
                  emoji={feature.country.emoji}
                  flagRatio={feature.country.flagRatio}
                  size="sm"
                />
                <span>{feature.country.name}</span>
                <span className="search__meta">{feature.country.capital ?? '—'}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
