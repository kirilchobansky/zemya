/**
 * The head tags every page shares: title, description, canonical, Open Graph, Twitter
 * card. A route's `meta` calls this with its own title and description and gets the rest
 * for free, so a page can't ship half a set. Absolute URLs come from SITE_URL (site.ts).
 */
import { absoluteUrl } from '~/lib/site';

export const OG_IMAGE = '/og-image.png';

interface PageSeo {
  title: string;
  description: string;
  /** Path as the site serves it: no trailing slash, no query. */
  path: string;
  type?: 'website' | 'article';
  /** A path or absolute URL; defaults to the site-wide card. */
  image?: string;
  /** Legacy redirect pages: tell crawlers not to index them. */
  noindex?: boolean;
}

export function pageMeta({ title, description, path, type = 'website', image = OG_IMAGE, noindex }: PageSeo) {
  // The prerenderer hands routes `/x/`, the host serves `/x` (trailingSlash: false).
  const url = absoluteUrl(path.length > 1 ? path.replace(/\/+$/, '') : path);
  const imageUrl = image.startsWith('http') ? image : absoluteUrl(image);
  return [
    { title },
    { name: 'description', content: description },
    ...(noindex ? [{ name: 'robots', content: 'noindex' }] : []),
    { tagName: 'link', rel: 'canonical', href: url },
    { property: 'og:site_name', content: 'Zemya' },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:url', content: url },
    { property: 'og:type', content: type },
    { property: 'og:image', content: imageUrl },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: imageUrl }
  ];
}

const prop = (name: string, value: string | number, unitText?: string) => ({
  '@type': 'PropertyValue',
  name,
  value,
  ...(unitText ? { unitText } : {})
});

/**
 * schema.org `Country`. That type has no capital / population / currency properties of
 * its own, and an invented property is worse than none, so those facts go in as
 * `additionalProperty` PropertyValues — the vocabulary's own extension point. Google has
 * no rich-result feature for Country; this is valid, machine-readable markup, not a
 * promise of a rich snippet.
 */
export function countryJsonLd(country: {
  slug: string;
  iso2: string;
  name: string;
  officialName: string;
  capital: string | null;
  population: number;
  area: number;
  currencyName: string | null;
  currencyCode: string | null;
  latlng: [number, number] | number[];
  region: string;
  hook: string;
}) {
  const facts = [
    country.capital && prop('Capital', country.capital),
    prop('Population', country.population),
    prop('Area', country.area, 'KMK'),
    country.currencyName &&
      prop('Currency', country.currencyCode ? `${country.currencyName} (${country.currencyCode})` : country.currencyName)
  ].filter(Boolean);
  const [lat, lon] = country.latlng;
  return {
    '@context': 'https://schema.org',
    '@type': 'Country',
    name: country.name,
    ...(country.officialName !== country.name ? { alternateName: country.officialName } : {}),
    description: country.hook,
    url: absoluteUrl(`/country/${country.slug}`),
    image: absoluteUrl(`/flags/${country.iso2.toLowerCase()}.svg`),
    ...(lat !== undefined && lon !== undefined
      ? { geo: { '@type': 'GeoCoordinates', latitude: lat, longitude: lon } }
      : {}),
    containedInPlace: { '@type': 'Place', name: country.region },
    additionalProperty: facts
  };
}

export function websiteJsonLd(description: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Zemya',
    url: absoluteUrl('/'),
    description,
    inLanguage: 'en'
  };
}
