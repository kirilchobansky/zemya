import { Link } from 'react-router';

import { formatNumber } from '~/lib/format';
import { countryBySlug, neighbourLinks } from '~/lib/geography/catalog.server';
import type { Route } from './+types/country';

export function loader({ params }: Route.LoaderArgs) {
  const country = countryBySlug(params.slug);
  if (!country) throw new Response('Not found', { status: 404 });
  return { country, neighbours: neighbourLinks(country) };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: 'Zemya' }];
  const { country } = loaderData;
  return [
    { title: `${country.name} — Zemya` },
    {
      name: 'description',
      content:
        `${country.name}: capital ${country.capital ?? '—'}, ` +
        `${formatNumber(country.population)} people, ${country.language ?? '—'}. ${country.hook}`
    }
  ];
}

export default function CountryPanel({ loaderData }: Route.ComponentProps) {
  const { country, neighbours } = loaderData;

  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">Dossier</span>
        <h2>{country.subregion || country.region}</h2>
      </header>

      <div className="panel__body">
        <div className="dossier__hero">
          <div className="dossier__flag">{country.emoji}</div>
          <div>
            <h3>{country.name}</h3>
            <div className="dossier__official">{country.officialName}</div>
          </div>
        </div>

        <div className="hook">
          <div className="hook__label">Memory hook</div>
          <p>{country.hook}</p>
        </div>

        <dl className="facts">
          <div className="fact">
            <dt>Capital</dt>
            <dd>{country.capital ?? '—'}</dd>
          </div>
          <div className="fact">
            <dt>Population</dt>
            <dd><span className="numeric">{formatNumber(country.population)}</span></dd>
          </div>
          <div className="fact">
            <dt>Area</dt>
            <dd><span className="numeric">{formatNumber(country.area)}</span> km²</dd>
          </div>
          <div className="fact">
            <dt>Density</dt>
            <dd>
              <span className="numeric">{country.density ? country.density.toFixed(1) : '—'}</span> / km²
            </dd>
          </div>
          <div className="fact">
            <dt>Currency</dt>
            <dd>
              {country.currencyName ?? '—'}{' '}
              <span className="numeric">
                ({country.currencyCode ?? '—'}
                {country.currencySymbol ? ` ${country.currencySymbol}` : ''})
              </span>
            </dd>
          </div>
          <div className="fact">
            <dt>Language</dt>
            <dd>
              {country.languages.join(', ') || '—'}
              <br />
              <span style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>{country.languageFamily}</span>
            </dd>
          </div>
          <div className="fact">
            <dt>Religion</dt>
            <dd>{country.religion}</dd>
          </div>
        </dl>

        <section>
          <h3 className="subhead">
            Land borders · {neighbours.length}
            {country.landlocked ? ' · landlocked' : ''}
          </h3>
          {neighbours.length ? (
            <div className="neighbours">
              {neighbours.map(n => (
                <Link className="neighbour" key={n.slug} to={`/country/${n.slug}`}>
                  {n.emoji} {n.name}
                </Link>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--ink-3)', fontSize: 12.5, margin: 0 }}>
              Island nation — no land neighbours.
            </p>
          )}
        </section>

        <div className="note">
          <b>Flag</b> — {country.flagDescription}
        </div>
        <div className="note">
          <b>Outline</b> — {country.outlineDescription}
        </div>
      </div>
    </>
  );
}
