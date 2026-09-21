import { Link } from 'react-router';

import { allCountries } from '~/lib/geography/catalog.server';
import { pageMeta, websiteJsonLd } from '~/lib/seo';
import type { Route } from './+types/atlas.index';

const DESCRIPTION =
  'An interactive world map built for learning geography: country dossiers, ' +
  'neighbour highlighting, choropleth overlays and true-size comparison.';

export function meta() {
  return [
    ...pageMeta({ title: 'Zemya — an atlas you can learn from', description: DESCRIPTION, path: '/' }),
    { 'script:ld+json': websiteJsonLd(DESCRIPTION) }
  ];
}

export function loader() {
  // a handful of large, recognisable countries as starting points
  const suggestions = allCountries()
    .slice()
    .sort((a, b) => b.population - a.population)
    .slice(0, 24)
    .sort(() => 0)
    .slice(0, 8)
    .map(c => ({ slug: c.slug, name: c.name, emoji: c.emoji }));
  return { suggestions };
}

export default function AtlasIndex({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">Dossier</span>
        <h2>Select a country</h2>
      </header>
      <div className="panel__body">
        <div className="empty">
          <div className="empty__icon">🧭</div>
          <p>
            Click any country to open its dossier. Its land neighbours light up in blue so
            you learn the shape of the region, not just the country.
          </p>
        </div>
        <section>
          <h3 className="subhead">Try one of these</h3>
          <div className="neighbours">
            {loaderData.suggestions.map(s => (
              <Link
                className="neighbour"
                key={s.slug}
                to={`/country/${s.slug}`}
                state={{ fly: true }}
              >
                {s.emoji} {s.name}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
