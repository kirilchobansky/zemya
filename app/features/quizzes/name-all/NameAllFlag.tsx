import type { CountryRecord } from '~/engines/map/types';

export function NameAllFlag({ country }: { country: CountryRecord }) {
  return (
    <img
      className="name-all__flag"
      src={`/flags/${country.iso2.toLowerCase()}.svg`}
      alt=""
      width={22}
      height={15}
      loading="lazy"
      decoding="async"
    />
  );
}
