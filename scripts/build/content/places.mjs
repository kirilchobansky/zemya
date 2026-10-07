import { require } from './config.mjs';
import { normaliseAlias } from './normalise.mjs';

/**
 * Capital-city coordinates, from GeoNames via the `all-the-cities` devDependency (build
 * time only — nothing from it ships). Joined on featureCode PPLC ("capital of a political
 * entity"), NEVER on largest population: Brasília, Canberra, Abuja, Ottawa and Wellington
 * are not their country's biggest city. The join is by ISO2 country + normalised name of
 * the AUTHORED capital, so a content edit to a capital moves its dot with it.
 *
 * Each entry below is a country whose authored capital does not match its GeoNames entry
 * once diacritics and punctuation are normalised away (Reykjavik/Reykjavík, Washington
 * D.C./Washington, D.C. and eleven more are handled by that normalisation alone). Value =
 * the spelling GeoNames uses. The name is looked up among the country's PPLC entries
 * first, then among ALL its entries — because for four countries the entry that is the
 * authored capital is not tagged PPLC at all:
 *   ISR Jerusalem  is PPLA  (GeoNames has no PPLC for Israel)
 *   PSE Ramallah   is PPL   (GeoNames has no PPLC for Palestine)
 *   SWZ Lobamba    is PPLG  (GeoNames' PPLC is Mbabane, the administrative capital)
 *   PAN Panamá     is PPLC, but "Panama City" is a different, 0-population PPLA3 town
 * The coordinates are what matter here; the label and quiz answer stay the authored name.
 */
const GEONAMES_CAPITAL = {
  FSM: 'Palikir - National Government Center',
  GRD: "Saint George's",
  KAZ: 'Nur-Sultan',       // GeoNames has not caught up with the 2022 rename back to Astana
  KIR: 'Tarawa',
  MMR: 'Nay Pyi Taw',
  SMR: 'San Marino',
  PAN: 'Panamá',
  ISR: 'Jerusalem',
  PSE: 'Ramallah',
  SWZ: 'Lobamba'
};

const allCities = require('all-the-cities');
const citiesByIso2 = new Map();
for (const city of allCities) {
  if (!citiesByIso2.has(city.country)) citiesByIso2.set(city.country, []);
  citiesByIso2.get(city.country).push(city);
}

/** The most populous entry with this exact (normalised) name, or null. `capitalOnly`
 *  restricts to PPLC. */
function findCity(iso2, name, capitalOnly) {
  const key = normaliseAlias(name);
  const hits = (citiesByIso2.get(iso2) ?? []).filter(
    c => (!capitalOnly || c.featureCode === 'PPLC') && normaliseAlias(c.name) === key
  );
  hits.sort((a, b) => b.population - a.population);
  return hits[0] ?? null;
}

export function buildPlaces(countries) {
  const places = [];
  const placeProblems = [];
  for (const country of countries) {
    if (!country.capital) { placeProblems.push(`${country.iso3}: no authored capital`); continue; }
    const geoName = GEONAMES_CAPITAL[country.iso3] ?? country.capital;
    const city = findCity(country.iso2, geoName, true) ?? (GEONAMES_CAPITAL[country.iso3] ? findCity(country.iso2, geoName, false) : null);
    if (!city) {
      placeProblems.push(`${country.iso3}: no GeoNames PPLC entry "${geoName}" for authored capital "${country.capital}"`);
      continue;
    }
    const [lon, lat] = city.loc.coordinates;
    places.push({
      name: country.capital,
      iso3: country.iso3,
      kind: 'capital',
      lon: Math.round(lon * 1e4) / 1e4,
      lat: Math.round(lat * 1e4) / 1e4,
      population: city.population
    });
  }
  if (placeProblems.length) {
    throw new Error(`places: countries without capital coordinates:\n  ${placeProblems.join('\n  ')}`);
  }
  for (const iso3 of Object.keys(GEONAMES_CAPITAL)) {
    if (!countries.some(c => c.iso3 === iso3)) throw new Error(`GEONAMES_CAPITAL: "${iso3}" is not in the catalogue`);
  }
  return places;
}
