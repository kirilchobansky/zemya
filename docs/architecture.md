# Architecture reference

Look-up material moved out of CLAUDE.md. Read the section that matches the area you are
touching; CLAUDE.md carries the rules that always apply. The quiz engine and its
engine/presenter split are in [quizzes.md](quizzes.md).

## Framework mode

React Router's framework mode fixes two of these names: the app lives in `app/`, and
static assets in `public/` (not `src/` and `static/`, as first sketched).

**This is not a renamed `src/`, and the Vite-template files are not missing.** Framework
mode replaces all three of them:

| Vite SPA template | here |
| --- | --- |
| `index.html` | `app/root.tsx` — its `Layout` export renders `<html>`/`<head>`/`<body>` |
| `src/main.tsx` | `app/entry.client.tsx` — `hydrateRoot(document, …)`, not `#root` |
| `src/App.tsx` | `app/routes.ts` (route table) + `root.tsx`'s `<Outlet/>` |

The entry files were materialised with `react-router reveal`; framework mode generates
them invisibly otherwise. Converting to the SPA layout would cost prerendering (197
crawlable country pages), `*.server.ts` stripping, and build-time loaders — see the
locked decisions above.

`app/entry.client.tsx` and `app/entry.server.tsx` are React Router's default entry
points, revealed deliberately so the boot sequence is visible rather than generated and
hidden. They are now maintained in this repo and will **not** receive upstream updates —
treat them as configuration, not application code, and check them against upstream
defaults after any React Router major upgrade.

## Places and capitals

`world.json` AND `world-coarse.json` both carry a top-level `places` array — a few KB,
duplicated on purpose (the brief said world.json; putting it in coarse too means the layer
and, later, the capital quiz's target dot exist from first paint instead of after the
3.4 MB download). `kind` is there so "top 3 cities per country" is more rows plus a filter;
**do not add non-capital cities without a decision.** `name` is the country's AUTHORED
capital (what the dossier says), not GeoNames' spelling.

**Source:** `all-the-cities` (devDependency, build time only, nothing ships; GeoNames).
Joined on `featureCode === 'PPLC'` by ISO2 + normalised name of the authored capital — never
on largest population (Brasília, Canberra, Abuja, Ottawa, Wellington aren't their
country's biggest city). `build-content.mjs` **throws** if any shipped country ends up
without coordinates. 179 of 197 match by exact string, 187 once diacritics/punctuation are
normalised; ten need `GEONAMES_CAPITAL` (GeoNames' spelling, looked up among PPLC first,
then any feature code): the six the brief listed (Micronesia, Grenada, Kazakhstan,
Kiribati, Myanmar, San Marino) **plus four the brief missed** — Panama (PPLC is "Panamá";
a different 0-population "Panama City" PPLA3 town exists and must not be used), Israel
(Jerusalem is PPLA, no PPLC in GeoNames), Palestine (Ramallah is a plain PPL) and Eswatini
(GeoNames' PPLC is Mbabane; the authored capital is Lobamba, a PPLG).

**Authored capitals checked for currency, nothing changed:** Burundi = Gitega (correct,
moved 2019), Tanzania = Dodoma, Côte d'Ivoire = Yamoussoukro, Kazakhstan = Astana (GeoNames
still says Nur-Sultan; handled above), Palau = Ngerulmud, Myanmar = Naypyidaw. Judgement
calls left to the owner, not changed: **Sri Lanka = Colombo** (the legislative capital is
Sri Jayawardenepura Kotte), **Eswatini = Lobamba** (Mbabane is the administrative capital),
Bolivia = Sucre (constitutional; La Paz is the seat of government), Netherlands =
Amsterdam (The Hague is the seat of government), Israel = Jerusalem and Palestine =
Ramallah (both politically contested — see the disputed-facet mechanism if it should stop
being quizzed).

**Visibility rule** (`renderer.ts`, `thresholds.ts`): a capital's **ring and name appear together** —
never a ring alone. All must hold: (1) zoom >= `CAPITAL_ZOOM_FACTOR` x homeZoom = **9x** (the old
name threshold; the ring used to come at 6x and read as an unlabelled dot); (2) its country is drawn
as a real shape, at least `CAPITAL_MIN_SHAPE_WIDTH` wide (a pin's width plus the ring's diameter);
(3) zoom >= `capitalRevealFactor(area, lat)`: the capital waits until the country's equivalent
square (side = sqrt(area), Mercator-corrected) is `CAPITAL_REVEAL_SIDE_PX` (60) across, capped at
200x. Big countries are past that at 9x; Cyprus/Jamaica come ~24-26x, Luxembourg 36x, Malta,
the Maldives and the Caribbean islands 100-170x, Monaco/San Marino/Tuvalu at the cap. Liechtenstein, Saint Vincent and Antigua are hand-set to 200x (`CAPITAL_REVEAL_OVERRIDES`, owner request after playing).
A calculation from area, not a per-country list, so a new country needs nothing. Area rather than
bbox width, because an archipelago's bbox is wide and its land isn't. Names try beside the ring,
then left, below, above before giving up, because a tiny country's own name sits on its capital.
Rings, names, hover and click all share `capitalShapeShowing`, so a ring you can't see can't be
hit. Tuned by playing (zoom sweeps into Liechtenstein, Cyprus, Monaco); the unit tests sweep it.

**Labels compete with country labels** for one collision list (`drawLabels` fills it with
country names first, larger claim, then `drawPlaceLabels` adds cities by descending
population), so a city and a country name can never overlap; the loser is simply not drawn
until there is room. 

**`quizMode` suppresses place rings, place labels and place tooltips/hit-testing**, through
the same one flag (`capitalsVisible()` is the single predicate drawing, labels and
`pickPlace()` all share, so they cannot disagree). A capital label at quiz zoom prints the
answer next to the dot.

**Capital names** (`matchesCapital`, `names.ts`) reuse `normaliseName` unchanged and are just
as exact — no fuzzy matching, a typo is wrong. `CountryRecord.capitalAliases` is the authored
capital plus `content/geography/capital-aliases.yaml` (a single hand-edited file like
`confusable-flags.yaml`: `country` by name, `add: [...]`, mandatory `note`). Things worth
knowing before editing it:
- **GeoNames' `altName` was investigated as a seed and is not usable** — empty for 196 of the
  197 capitals, and "IT" (junk) for the 197th. The YAML is the entire source of alternates.
- Normalisation already covers case, diacritics, apostrophes and dashes (`Chisinau`, `Sanaa`,
  `Ulan-Bator`, `Nuku'alofa`), so don't list those. It does *not* cover `ø`
  (`København` and `Kobenhavn` both listed), `Washington DC` vs the authored `Washington
  D.C.` (`washington dc` vs `washington d c`), or anything that differs by a whole word.
- **South Africa's three capitals** (Pretoria authored, Bloemfontein and Cape Town added) go
  through this same list — no special case anywhere. The dot sits on Pretoria.
- **Deliberate additions worth a second look** (all in the YAML with notes): Eswatini also
  accepts Mbabane, Sri Lanka also accepts Kotte / Sri Jayawardenepura Kotte, Palau accepts
  Melekeok, and bare `Panama`/`Guatemala`/`Kuwait`/`Andorra` are accepted for their
  same-named capitals. **Burundi does not accept Bujumbura**: Gitega is the capital since
  2019 and accepting the old one would teach the wrong answer.
- **The collision check throws, it does not drop.** Country aliases silently strip an
  ambiguous name from both countries; capital aliases are hand-written, so two countries
  claiming one normalised name is a mistake to fix, and the build fails naming both.
  (Verified by planting `Luxembourg: add [Bruxelles]`.)

## Progress and scheduling

A country is not one thing you know — you can know Bulgaria's capital and not its
currency — so the unit of scheduling is a **(country, facet) pair**, one FSRS card each.
Facets: `location`, `capital`, `flag`, `currency`, `language`, `religion`, `borders`,
`outline`. A facet only applies when the country has the data for it (no `borders` card
for an island, no `currency` card where the field is null); the applicable set is the
denominator for mastery, computed per country in `app/lib/geography/mastery.ts`.

Card ids are `subject:entity:facet` strings — `geo:BGR:capital` — prefixed so history can
later write `hist:treaty-of-berlin:date` into the same tables without collision. The
prefix is a geography-layer convention, not a core concept: `app/lib/core/` stores and
grades opaque id strings and must never import from `app/lib/geography/`.

Cards are created **lazily**. No row exists until a facet is first reviewed — "new" is the
absence of a row, not a row in a new state. 197 countries never means 1,576 rows up front.

Country mastery is **derived, never stored**, from whatever cards exist for it:
- **new** — no cards for this country
- **learning** — at least one card exists
- **mastered** — every applicable facet has a card that has graduated to FSRS `Review`

"Graduated to Review" is FSRS's own definition of learned; do not invent a threshold.

**Writes are never awaited by the UI.** `app/lib/core/progress.ts` updates in-memory state
synchronously and renders immediately — `saveCard` and `logReview` are fire-and-forget,
log a failure and move on. Only the explicit export / import / reset operations are async,
because the user asked for them and is watching.

**SSR guard.** Route loaders run at build time, where `indexedDB` does not exist. Nothing
in `app/lib/core/` touches `indexedDB` at module scope — the Dexie instance is constructed
lazily behind a browser check, so importing the store from a route module is inert during
prerender. If `npm run build` starts failing inside prerender, look here first.

**Every table the app writes must be covered by reset, export and import.** `quizRuns`
shipped covered by neither: `resetAll()` only cleared `cards`/`reviews`, so a timer bug's
bogus 1-second personal best survived a full progress reset, and `exportAll`/`importAll`
didn't touch it either, so it couldn't even travel with a backup. A table only one of the
three knows about is how data goes stale (reset) or orphaned (export/import) — when a new
table is added to `app/lib/core/progress.ts`, add it to all three in the same commit, not
"when it comes up."

## Prerendering and tests

Prerendered pages: 197 countries, the atlas/study/quiz-subject/quiz-list index pages, and
every valid `/quizzes/geography/:id/:scope/:size` (22 per quiz today, three quizzes), plus
the old flat `/quiz`, `/quiz/:id/:scope/:size` and `/quiz/:id/:size` paths (predating the
subject layer, indexed on Google before it existed) kept as permanent redirect stubs to
their `/quizzes/geography/...` equivalent, and the removed-scope (`americas`) redirects,
prerendered for the two quizzes that predate scopes only. See docs/quizzes.md's "Subjects".

`npm run test:unit` needs no build — it exercises `app/lib/core/` and
`app/lib/geography/mastery.ts` directly, importing real content through the same
`catalog.server.ts` reader every route loader uses. `test/unit/progress.test.ts` is the
one exception that needs a real IndexedDB to exercise `progress.ts`'s actual Dexie code
(rather than the `available() === false` no-op path) — it pulls in `fake-indexeddb`
(devDependency only, `fake-indexeddb/auto` imported at the top of that file) rather than
mocking Dexie by hand.

## Editing content and deploying

Change a memory hook in `content/geography/countries/<slug>.yaml`, then:

```bash
npm run build:content
```

Commit both the YAML and the regenerated `public/data/geography/*.json` in the same
commit — there is no CI here to catch a drift between them (see CLAUDE.md's Git
conventions).

### Deploying

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

## Repository layout

Moved from CLAUDE.md's Structure section (the rules that follow from it stay there).


```
content/geography/      hand-authored YAML, one file per country. THE MOAT.
content/flags/          flag overrides: <iso2>.svg + mandatory <iso2>.note.md. Empty unless upstream is wrong.
scripts/                content/ + upstream datasets -> public/data/
app/root.tsx            the HTML document itself + the top-level App
app/routes.ts           the route table
app/entry.client.tsx    hydrates the prerendered document
app/entry.server.tsx    renders each route to HTML at build time
app/lib/core/           scheduler + Dexie store. subject-agnostic; no geography imports.
app/lib/map/            projection, topology, camera, renderer, controller. no React.
app/lib/geography/      overlays, client payload loader, *.server.ts catalog readers,
                        mastery derivation
app/lib/history/        time-axis logic only (scale.ts). no UI yet — see CLAUDE.md's "Do not"
app/lib/format.ts       shared formatting and normalisation
app/components/         Rail, SearchBox, and future panels
app/routes/             atlas.tsx (layout, owns the canvas) + panel routes
app/styles/             tokens.css then app.css
content/history/        hand-authored YAML, one file per language/country code (bg.yaml)
public/data/geography/  generated, committed on purpose
public/data/history/    generated, committed on purpose
public/flags/           generated from flag-icons, committed on purpose
test/smoke.mjs          end-to-end browser test against the production build
```

Framework mode replaces `index.html`/`main.tsx`/`App.tsx` with `root.tsx`,
`entry.client.tsx` and `routes.ts`; nothing is missing. See `docs/architecture.md`.

