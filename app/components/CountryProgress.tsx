/**
 * The read-only progress block in the dossier: one pill summarising the country, and the
 * per-facet breakdown underneath. Nothing here grades anything — reviewing arrives with
 * the quiz screens, and this is what those will move.
 *
 * Renders the "nothing yet" state during prerender and on the first client render, which
 * is exactly what an untouched browser should see anyway, so hydration matches.
 */
import { useProgress } from '~/lib/core/ProgressProvider';
import { countryMastery, facetProgress, type CountryMastery } from '~/lib/geography/mastery';
import { MASTERY_COLOURS } from '~/lib/geography/overlays';
import type { CountryRecord } from '~/lib/map/types';

const PILL_LABELS: Record<CountryMastery, string> = {
  new: 'Not yet seen',
  learning: 'Learning',
  mastered: 'Mastered'
};

export function CountryProgress({ country }: { country: CountryRecord }) {
  const { cards } = useProgress();
  const state = countryMastery(country, cards);
  const facets = facetProgress(country, cards);
  const learned = facets.filter(f => f.learned).length;

  return (
    <div className="progress">
      <span className="pill" style={{ color: MASTERY_COLOURS[state] }} data-state={state}>
        <span className="pill__dot" style={{ background: MASTERY_COLOURS[state] }} />
        {PILL_LABELS[state]}
        <span className="pill__count numeric">
          {learned}/{facets.length}
        </span>
      </span>

      <ul className="facets">
        {facets.map(facet => (
          <li
            className="facet"
            key={facet.facet}
            data-learned={facet.learned || undefined}
            data-seen={facet.seen || undefined}
          >
            <span
              className="facet__dot"
              style={{
                background: facet.learned
                  ? MASTERY_COLOURS.mastered
                  : facet.seen
                    ? MASTERY_COLOURS.learning
                    : 'transparent'
              }}
            />
            {facet.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
