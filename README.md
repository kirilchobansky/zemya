# Zemya

An interactive atlas built for learning, not for looking things up.

The premise: every subject has one natural spatial index, and learning should happen by
navigating that index rather than by flipping cards. Geography's index is the map.
History's is the timeline. Zemya starts with geography and is structured so history can
share the same data model rather than sit beside it as a separate app.

## Status

Pre-alpha, and buildable.

The production app is React 19 + Vite + TypeScript on React Router v8, prerendered to 199
static pages. It does the atlas half — the map, country dossiers, neighbour highlighting,
five choropleth overlays, search, and true-size comparison — plus a first study mode
(nine question kinds over FSRS-scheduled cards). See CLAUDE.md's "Where this is" for the
current state in more detail.

## Repository layout

| Path | What it is |
| --- | --- |
| `content/geography/countries/` | Hand-authored source of truth — one YAML file per country holding its memory hook, flag description, outline description and religion. Editable without touching code. |
| `scripts/` | Build pipeline turning `content/` plus two upstream datasets into shipped JSON. |
| `public/data/geography/` | Generated data, committed deliberately so deploys can't break from an upstream dataset shifting. |
| `app/lib/map/` | The map engine — projection, topology, camera, canvas renderer, interaction. No React in it. |
| `app/routes/` | `atlas.tsx` owns the canvas; the child routes render only the right-hand panel. |

`content/` is the part of this project with actual value. The canvas renderer can be
rewritten in a weekend; 197 hand-written memory hooks cannot.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

To build the static site exactly as it deploys:

```bash
npm run build      # regenerates public/data, then prerenders 199 pages
npm test           # serves build/client and drives a real browser over it
```

Output lands in `build/client/` — plain files, no server required.

### Editing content

Change a memory hook in `content/geography/countries/<slug>.yaml`, then:

```bash
npm run build:content
```

Commit both the YAML and the regenerated `public/data/geography/*.json` in the same
commit — there is no CI here to catch a drift between them (see CLAUDE.md's Git
conventions).

## Deploying

Zemya deploys to Vercel as pure static files; `build/server` is emitted but never used,
because every route is prerendered. `vercel.json` carries the settings:

- **Build command** `npm run build`, **output directory** `build/client`, framework
  preset none (so Vercel doesn't try to run the server build). Nothing serverless.
- **URLs** have no trailing slash (`cleanUrls`, `trailingSlash: false`); `/country/bulgaria/`
  redirects to `/country/bulgaria`. Deep links are the only acquisition channel.
- **`*.data`** is served as `text/x-script`, what React Router's own server sends. These
  are fetched on client-side navigation, and the wrong type fails silently.
- **Caching**: `/assets/*` is `immutable` for a year (Vite hashes the filenames); everything
  else, including `/data/*`, `/flags/*`, HTML and `.data`, must revalidate because those
  filenames don't change between builds. Making the data URLs content-addressed is the
  planned fix — `docs/performance.md`.
- **404**: `public/404.html`, a static page with no dependency on the app bundle.

Note: Vercel's Hobby tier forbids commercial use.

Verify before deploying:

```bash
npm run typecheck
npm run build:content
npx react-router build   # or npm run build, which runs build:content first
npm run test:unit
npm test                 # needs the build above; CHROMIUM_PATH in the sandbox
```

## Data sources

Every dataset the project uses, what it is for, and its licence. Licences were read from
each package's own `package.json` / `LICENSE` in `node_modules`, not from memory.

| Data | Used for | Licence |
| --- | --- | --- |
| [world-countries](https://github.com/mledoze/countries) 5.1 (mledoze/countries) | Country names and spellings, capitals, currencies, languages, borders, ISO codes | **ODbL-1.0** (share-alike; why `public/data/` is ODbL — see [LICENSE](LICENSE)). Its flag images are not part of that licence; we do not use them. |
| [Natural Earth](https://www.naturalearthdata.com/) 1:10m, via [world-atlas](https://github.com/topojson/world-atlas) 2.0 | Country polygons and the land layer | Natural Earth: public domain. world-atlas packaging: ISC. |
| [GeoNames](https://www.geonames.org/), via [all-the-cities](https://github.com/zeke/all-the-cities) 3.1 (build time only) | Capital-city coordinates and populations | **CC BY 4.0** (GeoNames' published licence) — **attribution required, credited in the app** (left rail footer). The npm package itself is MIT. |
| [svg-country-flags](https://github.com/hjnilsson/country-flags) 1.2 | The flag images in `public/flags/` | Public domain (the package's own declaration; national flags are not under copyright protection, though some countries restrict their use as emblems) |
| [countries-list](https://github.com/annexare/countries) 3.4 (dev only) | Second, independent source for `npm run audit` — never shipped in the data | MIT (the package's own `package.json`) |
| [country-json](https://github.com/samayo/country-json) 2.3 | Population fallback for countries without an authored figure | MIT (the package; it does not state a separate licence for its figures) |
| Hand-authored: memory hooks, flag and outline descriptions, religion, population overrides, aliases | Everything under `content/` | ODbL-1.0 with the rest of the data ([LICENSE](LICENSE)) |
| [Fraunces](https://fonts.google.com/specimen/Fraunces), [Archivo](https://fonts.google.com/specimen/Archivo), [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) | Type, loaded from Google Fonts | SIL Open Font License 1.1 |

Runtime and build dependencies, from their own `package.json`: dexie Apache-2.0 ·
ts-fsrs MIT · react, react-dom, react-router MIT · isbot Unlicense · topojson-client,
topojson-simplify, yaml ISC · dev tooling (vite, vitest, TypeScript, Playwright,
fake-indexeddb, @react-router/*) MIT or Apache-2.0.

A new dataset gets its licence checked and recorded in this table **before** it is used,
and anything requiring attribution is credited in the app, not only here.

## Licence

Dual-licensed: code **MIT**, data (`content/` and `public/data/`) **ODbL-1.0**. See
[LICENSE](LICENSE) for the split and the reason for it.
