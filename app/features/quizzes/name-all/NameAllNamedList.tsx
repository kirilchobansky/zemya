import type { Ref } from 'react';

import type { CountryRecord } from '~/engines/map/types';
import { NameAllFlag } from './NameAllFlag';

/** The countries named so far, in the order they were found; the newest gets `listEndRef`. */
export function NameAllNamedList({ countries, listEndRef }: { countries: readonly CountryRecord[]; listEndRef: Ref<HTMLLIElement> }) {
  return (
    <ol className="name-all__list" aria-label="Countries named">
      {countries.map((c, i) => (
        <li key={c.iso3} className="name-all__item" ref={i === countries.length - 1 ? listEndRef : undefined}>
          <NameAllFlag country={c} />
          <span>{c.name}</span>
        </li>
      ))}
    </ol>
  );
}
