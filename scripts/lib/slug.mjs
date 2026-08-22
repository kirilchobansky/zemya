/**
 * Country name -> URL slug.
 *
 * Slugs are part of the public URL surface (`/country/bulgaria`), so once a
 * country ships its slug must not change. Overrides below exist for names whose
 * mechanical transliteration reads badly or would collide.
 */
const OVERRIDES = {
  TUR: 'turkey',                 // "Türkiye" -> turkiye is correct but unsearchable
  CIV: 'ivory-coast',
  COD: 'dr-congo',
  COG: 'republic-of-the-congo',
  STP: 'sao-tome-and-principe',
  MMR: 'myanmar',
  SWZ: 'eswatini',
  CPV: 'cape-verde',
  VAT: 'vatican-city',
  PSE: 'palestine',
  TLS: 'timor-leste',
  MKD: 'north-macedonia',
  BIH: 'bosnia-and-herzegovina',
  VCT: 'saint-vincent-and-the-grenadines',
  KNA: 'saint-kitts-and-nevis',
  ATG: 'antigua-and-barbuda',
  TTO: 'trinidad-and-tobago',
  ARE: 'united-arab-emirates',
  GBR: 'united-kingdom',
  USA: 'united-states',
  CAF: 'central-african-republic',
  DOM: 'dominican-republic',
  FSM: 'micronesia',
  MHL: 'marshall-islands',
  SLB: 'solomon-islands',
  PNG: 'papua-new-guinea',
  NZL: 'new-zealand',
  ZAF: 'south-africa',
  SSD: 'south-sudan',
  KOR: 'south-korea',
  PRK: 'north-korea',
  LKA: 'sri-lanka',
  SAU: 'saudi-arabia',
  CZE: 'czechia',
  CHE: 'switzerland'
};

export function slugify(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[''`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function slugFor(country) {
  return OVERRIDES[country.cca3] || slugify(country.name.common);
}
