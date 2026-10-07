# Architecture reference

Look-up material moved out of CLAUDE.md. Read the section that matches the area you are
touching; CLAUDE.md carries the rules that always apply. The quiz engine and its
engine/presenter split are in [quizzes.md](quizzes.md).

## Interaction principles

Moved from CLAUDE.md, which keeps a one-line pointer.

> The camera moves only when the user could not already see the target. Clicking a country
> on the map never moves the camera; arriving from search, a link, or a cold URL does.
> Any new way of selecting a country must decide which of those two it is. The quiz obeys the
> same rule: a new question moves the camera only when the player couldn't already see the target.

| What I do | Camera |
| --- | --- |
| Click a country on the map | does NOT move |
| Click a capital's ring (zoomed in) | selects its country; does NOT move |
| Click empty ocean (deselect) | does NOT move |
| Pick a result from search | flies to it |
| Click a neighbour chip in the dossier panel | flies to it |
| Click a suggestion on the index panel | flies to it |
| Open /country/<slug> cold (fresh load or shared link) | flies to it |
| Press the ⌂ reset button | returns to world view |
| A new quiz question (answer, skip or reveal alike) | returns the view if zoomed in, then moves ONLY if the target isn't comfortably visible and legible — one path, `Atlas#followTarget`; see `docs/quizzes.md` |
| Wheel, drag, pinch, double-click | unchanged |

Intent travels as React Router location state: `state={{ fly: true }}` on a `Link`,
`{ state: { fly: true } }` on `navigate()`. The map's own click handler passes nothing.
`flyTo` and `home` on the Atlas controller are unchanged by this rule — it governs who
calls them, not what they do.

## Map renderer (MapLibre GL)

One renderer: MapLibre GL JS, Web Mercator, our own data only (no basemap, no outside tiles, no
glyph server). `app/engines/map/`:

| file | role |
| --- | --- |
| `controller.ts` | `MapController` + `AtlasCallbacks`: everything the app may ask of the map (`setStyle`, `setFocus`, `home`, `flyTo`, `followTarget`, `pulse`, `fit`, `startCompare`, `view`, `screenPosition`, ...) |
| `engine.ts` | lazy loader — the only way `gl-atlas.ts` (and so MapLibre) is reached; both the chunk import and whole-map creation go through `withRetry` |
| `retry.ts`, `load-error.ts` | `withRetry` (3 attempts, 400 ms then 1200 ms), `fetchStrict`/`fetchJsonStrict` (a retry uses `cache: 'no-cache'`), `LoadError` with its `step` (`data`, `chunk`, `tiles`, `map`, `webgl`), the per-attempt `console.error` |
| `pmtiles-archive.ts` | `world.pmtiles` downloaded whole, validated, served to the `pmtiles` protocol from memory (`MemorySource`) |
| `gl-load.ts` | `whenMapLoaded` and which map errors are fatal; `gl-pulse.ts` the quiz pulse ring |
| `gl-atlas.ts` | the controller facade (`GlAtlas`): create/destroy, the public `MapController` API, resize, pulse; delegates to the modules below |
| `gl-setup.ts` | the one place the MapLibre `Map` is constructed (worker, protocols, options, momentum off, attribution, test seam) |
| `gl-camera.ts` | camera moves, fly-to, fit, the quiz follow decision, move events |
| `gl-styling.ts` | feature state and static-layer paint, capital ring image, graticule ranges |
| `gl-view-sync.ts` | per-camera work: pins/dots/halos, name and capital filters, the quiz place ring |
| `gl-hover.ts`, `gl-picking.ts` | hover reporting and click selection; which country or ring is under a point |
| `gl-compare.ts` | the comparison outline drag and the capture-phase input rules |
| `gl-host.ts` | the view of `GlAtlas` its collaborators may read |
| `gl-style.ts` | sources, layer table, feature-state keys (read top to bottom = "what the map is") |
| `gl-geo.ts` | runtime GeoJSON: country anchors, capitals, graticule, compare outline |
| `visibility.ts` | the per-camera predicates (`drawsAsPin`, `showsAsDot`, `haloAlpha`, `capitalsVisible`, `capitalShapeShowing`) — pure, unit-tested; thresholds in `thresholds.ts` |
| `style.ts` | the app's `Style` (callbacks per country) and the `COLORS` palette |
| `camera.ts`, `follow.ts`, `projection.ts` | unit-square camera maths, unchanged. `zoom` = world width in px = `512 * 2^mapZoom` |
| `topology.ts` | `World`/`Feature` records (bbox, anchor, polygons, neighbours, halos); `Path2D` only for the Outlines quiz silhouettes |

**Tiles.** `scripts/build/build-tiles.mjs` (second half of `build:content`) cuts `world.json` into
`public/data/geography/world.pmtiles` with geojson-vt: layers `countries` (`iso3`, the feature id
via `promoteId`), `context` (Greenland etc.), `lakes`, `halos`; z0-z7, extent 4096, tolerance 2.5
units (about a third of a pixel at every zoom), **no simplification at z7** (full 1:10m); beyond z7
MapLibre overzooms. Written by `scripts/lib/pmtiles-writer.mjs` (PMTiles v3, gzip). The browser
fetches the **whole file once** (~3.3 MB, one plain GET) and the `pmtiles` protocol reads it from memory
through a custom `Source` (`pmtiles-archive.ts`): no Range, ETag partial or content-encoding behaviour of
the CDN is involved. `build-tiles.mjs` also writes `world.pmtiles.json` (`bytes`, `sha256`); the download
is checked against it and the PMTiles header (`"PMTiles"`, version 3). A copy that fails is refetched once
with `cache: 'reload'`; failing again is a `tiles` `LoadError`. The
longitude frame (antimeridian unwrap, `frameToReference`) is `scripts/lib/geom.mjs`, shared with
`topology.ts`, so tiles and Features always agree. Attribution (Natural Earth, ODbL country data)
rides in the source and shows in MapLibre's attribution control; the rail footer says ODbL too.

**Loading and failure** (a map that does not load must say why, and recover without a reload):
- *Steps.* `data` (`countries.json`, `world-coarse.json`, each retried alone by `loadWorld`), `chunk`
  (dynamic import of the renderer), `tiles` (the archive, or the tile source's metadata), `map` (style /
  setup), `webgl` (no context; never retried). Each failed attempt is one
  `console.error('[map-load] step=… attempt=n/3 url=… status=… — message')`.
- *Fatal vs not.* `GlAtlas.create` rejects only for no WebGL or style / tile-source metadata failing
  (`gl-load.ts`); the listeners it adds are removed once it settles. A failed tile or glyph request is
  logged and left to MapLibre. `engine.create` retries the whole map: the failed one is destroyed, a
  fresh one built (the downloaded archive is kept).
- *UI.* `useMapController` exposes `error` (step + real message + URL/status), `retrying` (shown as
  "Retrying…" in `MapNotices`), `restoring` and `retry()`, which bumps a key that re-runs the data load and
  the map creation (no page reload). The root `ErrorBoundary` keeps its message, adds the error text and a
  Retry (a page reload: there is nothing finer to re-run there).
- *Stale deploys.* `shared/lib/stale-deploy.ts`: `vite:preloadError`, or the `chunk` step still failing
  after its retries, reloads the page once; a `sessionStorage` stamp allows one reload a minute, and
  without storage nothing reloads. (A browser may remember a failed dynamic import for the page's life, so
  the chunk retries can be moot; the reload is what recovers.)
- *WebGL context loss.* MapLibre prevents the default and rebuilds its style; `GlAtlas` reports
  `onStatus('restoring')` and, once the restored map is idle, redoes ring image, graticule, anchors and feature
  state (`redraw`), then `onStatus('ready')`.

**Feature state, not geometry.** Keys: `c` land colour, `pc` pin/halo colour, `sc`/`sw` emphasised
border (selected, neighbour, hover, quiz target; two line layers so the heavy one is on top), `fo`
pin focus (2 = quiz target), `hide` (country is a pin right now: no shape), `dot`, `halo` (0..1).
`restyle()` writes them from the app's `Style` callbacks (overlays, mastery and quiz outcome all
arrive that way), `syncView()` from the camera; both diff against what was last applied, so a pan
costs nothing in steady state. A theme change re-reads the palette and rewrites everything.

**Labels and capitals.** Symbol layers; MapLibre does the collision (country names first, largest
area first via `symbol-sort-key`; capitals beneath them; micro-state names beside the pin). Which
features are *candidates* is the old canvas logic (`visibility.ts` + a minimum on-screen width and a
text-fits test), applied as a layer filter only when the set changes. A capital's ring is an icon in
the same symbol layer as its name, neither optional, so a ring whose name found no room is not placed
(and cannot be hit). Glyphs: MapLibre's `font-faces` with the self-hosted Archivo files
(`@fontsource/archivo`, OFL, bundled by Vite) rasterised locally; the `glyphs` URL is a stub protocol
answering empty ranges, so nothing is fetched from outside. Country-name size comes from area
(`labelSize`), not from the on-screen width.

**Camera.** MapLibre's gestures and easing, with no momentum: drags, flicks and pinches stop where the input stops, wheel steps apply directly (`GlAtlas.disableMomentum` replaces two MapLibre internals, guarded; programmatic `easeTo` keeps its animation). `fadeDuration: 0` and a zero style `transition` make labels vanish the frame they should; `syncView` is gated on a `ready` flag, not `isStyleLoaded()` (false while tiles load, which left labels stale). A CameraState is converted to centre + zoom.
`transformConstrain` reimplements `clampY`/`clampZoom` (the visible area, minus insets, stays in the
map; a portrait phone can still show the whole world). Zoom range is `homeZoom * 0.78 .. * 320`.
`ownEase`/`heading` give `followTarget` the camera's destination while a fly is running.

**Hit-testing.** Pins by screen distance (touch radius 24 px), then `queryRenderedFeatures` on the
countries layer (shapes that are pins are skipped), then halos (smallest first). Capitals are queried
on the symbol layer, so only a placed ring is hittable. Hover is mouse-only.

**Compare size.** The dragged outline is a GeoJSON source (`reprojectPolygonsToTrueSize`); a
capture-phase listener starts a drag on it before MapLibre sees the event, so the map does not pan.

**Client geometry payload.** The app fetches `world-coarse.json` (~500 KB, every polygon kept,
simplified at 0.006 deg ~ 600 m) plus `countries.json`, and nothing else for geometry:
`geography/world.ts`'s `loadWorld()` builds the `World` from those. It feeds the camera maths
(bbox, anchors), the Outlines silhouette and the compare shape, none of which can show the difference
from 1:10m. The full `world.json` (3.4 MB) is a build input only (`build-tiles.mjs` reads it); no
client code requests it, and `tests/e2e/smoke.mjs` fails if anything does. Needing it again means
fetching it on demand from the feature that needs it, cached, never from `loadWorld()`.
`attachFullDetail` in `topology.ts` is now unused by the app (kept, with its unit coverage, until
someone decides to delete it). Without WebGL the map shows the "failed to load" message (there is no
canvas fallback any more).

**Test seam.** `gl-atlas.ts` exposes the MapLibre instance as `window.__zemyaGl` in dev, and in a
production build only for a page whose init script set `window.__ZEMYA_PROBE__` first; `tests/e2e/smoke.mjs`
and `tests/e2e/perf.mjs` do, nothing a visitor does can. Tests ask it `queryRenderedFeatures`,
`getFeatureState`, `isStyleLoaded()/areTilesLoaded()` and never read pixels.

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
duplicated on purpose (the client only ever loads coarse, so the layer
and the capital quiz's target dot need it there). `kind` is there so "top 3 cities per country" is more rows plus a filter;
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
denominator for mastery, computed per country in `app/features/countries/mastery.ts`.

Card ids are `subject:entity:facet` strings — `geo:BGR:capital` — prefixed so history can
later write `hist:treaty-of-berlin:date` into the same tables without collision. The
prefix is a geography-layer convention, not a core concept: `app/features/progress/` stores and
grades opaque id strings and must never import from `app/features/countries/`.

Cards are created **lazily**. No row exists until a facet is first reviewed — "new" is the
absence of a row, not a row in a new state. 197 countries never means 1,576 rows up front.

Country mastery is **derived, never stored**, from whatever cards exist for it:
- **new** — no cards for this country
- **learning** — at least one card exists
- **mastered** — every applicable facet has a card that has graduated to FSRS `Review`

"Graduated to Review" is FSRS's own definition of learned; do not invent a threshold.

**Writes are never awaited by the UI.** `app/features/progress/progress.ts` updates in-memory state
synchronously and renders immediately — `saveCard` and `logReview` are fire-and-forget,
log a failure and move on. Only the explicit export / import / reset operations are async,
because the user asked for them and is watching.

**SSR guard.** Route loaders run at build time, where `indexedDB` does not exist. Nothing
in `app/features/progress/` touches `indexedDB` at module scope — the Dexie instance is constructed
lazily behind a browser check, so importing the store from a route module is inert during
prerender. If `npm run build` starts failing inside prerender, look here first.

**Every table the app writes must be covered by reset, export and import.** `quizRuns`
shipped covered by neither: `resetAll()` only cleared `cards`/`reviews`, so a timer bug's
bogus 1-second personal best survived a full progress reset, and `exportAll`/`importAll`
didn't touch it either, so it couldn't even travel with a backup. A table only one of the
three knows about is how data goes stale (reset) or orphaned (export/import) — when a new
table is added to `app/features/progress/progress.ts`, add it to all three in the same commit, not
"when it comes up."

## Prerendering and tests

Prerendered pages: 197 countries, the atlas/study/quiz-subject/quiz-list index pages, and
every valid `/quizzes/geography/:id/:scope/:size` (22 per quiz today, three quizzes), plus
the old flat `/quiz`, `/quiz/:id/:scope/:size` and `/quiz/:id/:size` paths (predating the
subject layer, indexed on Google before it existed) kept as permanent redirect stubs to
their `/quizzes/geography/...` equivalent, and the removed-scope (`americas`) redirects,
prerendered for the two quizzes that predate scopes only. See docs/quizzes.md's "Subjects".

`npm run test:unit` needs no build — it exercises `app/features/progress/` and
`app/features/countries/mastery.ts` directly, importing real content through the same
`catalog.server.ts` reader every route loader uses. `app/features/progress/progress.test.ts` is the
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
content/history/        hand-authored YAML, one file per history country (bg.yaml, us.yaml)
public/data/geography/  generated, committed on purpose
public/data/history/    generated, committed on purpose
public/flags/           generated from flag-icons, committed on purpose

scripts/build/          content/ + upstream datasets -> public/data/ (build-content over build/content/, build-history, build-tiles, icons, og image)
scripts/import/         one-off history importers (import-events, import-rulers over import/rulers/)
scripts/audit/          read-only reports and QA (audit-freshness, audit-flags, check-history, check-seo)
scripts/lib/            Node helpers shared by the above and, for a few pure ones, by app/ (geom, history, halo, site, ...)
scripts/check-structure.mjs   300-line limit (no allow-list) + import boundaries (npm run check)
tests/e2e/              smoke.mjs (runner) + areas/ + lib/, and perf.mjs: drive a real browser (docs/structure.md "Browser tests")

app/root.tsx, routes.ts, entry.client.tsx, entry.server.tsx   document, route table, hydrate, prerender
app/routes/             route modules only, thin: loader, clientLoader, meta, mounting (URLs come from routes.ts, not folders)
  map/                  atlas.tsx (layout: the shared CSS imports in their load order + ProgressProvider + AtlasShell),
                        atlas.index.tsx, country.tsx, atlas.css / atlas.phone.css
  quizzes/              quizzes.tsx, quizzes.$subject.tsx, quizzes.$subject.$quizId.tsx, legacy /quiz redirects
  history/              history.tsx, history.$slug.tsx, history.$slug.list.tsx
  questions/            questions.tsx (-> features/questions), study.tsx (redirect)

app/features/           one folder per product area; index.ts exposes what other features use
  map/                  the atlas shell. atlas-context.ts, up.ts, sidebar-storage.ts, micro.ts,
                        components/ (AtlasShell, AtlasPanel, HistoryLayer, MapTopHud, MapBottomHud, MapNotices,
                        Rail (+ EdgeArrow, LayerControls, ProgressSection, DataSection, ThemeControls), MobileChrome, UpButton), hooks/ (use-map-controller, use-history-canvas,
                        use-sidebars, use-phone-sheet)
  countries/            catalog.server, names(-bg), scopes, overlays (+ overlay-palettes), outline, world, mastery, quizSeo,
                        the Questions session generator (questions.ts barrel over question-kinds,
                        distractors, question-generators, session, religion), components/ (SearchBox, CountryProgress)
  questions/            the Questions page: QuestionsPanel, QuestionCard, QuestionsResult, use-question-session
  quizzes/
    engine/             useQuizEngine (engine.ts + engine-types, use-quiz-keyboard, use-quiz-timer, use-prior-best,
                        run-result), types, insets, subjects registry, QuizControls/StageClock/StartCaption/PauseIcon
    geography/          quiz definitions (quizzes.ts) and stages/ (Map, Flags, Outlines, ... Stage)
    name-all/           "Name all countries": NameAllQuiz container + use-name-all-world/run/atlas hooks,
                        NameAllPanel, NameAllResult, NameAllDock, NameAllHud, NameAllNamedList, NameAllFlag
    history-fill/       "fill the list": fill-quiz (+ fill-matching), fill-quiz-config, fill-quizzes.server, HistoryFillQuiz
                        container + use-fill-run, FillGrid, FillInputBar, FillResult, FillToggle, FillPhoneHud
    pages/              the list and run pages: QuizList(+Item, HistoryPanel), HistoryCountries,
                        HistoryCountryQuizzes, QuizRun(+Panel, Result, Hud) and their hooks
  history/
    timeline/           the canvas timeline: renderer.ts (render entry) over render-*/draw-*/wire-layout,
                        timeline.ts (HistoryTimeline) over timeline-config/-model/-framing/-fonts/-hover/-gestures,
                        fly-animation, period-reporter, frame-scheduler; scale (barrel over scale-config/-time/-viewport/-ticks/-visibility), layout
    data/               countries, catalog.server, related, search
    components/         HistoryCard (+ history-card-format), HistoryDetail, HistoryFilters, HistoryOutline, HistorySearch
  progress/             ProgressProvider, progress (Dexie store), scheduler (ts-fsrs), questions (generic Question + RNG).
                        Subject-agnostic: imports nothing from features/countries.

app/engines/map/        projection, topology, camera, follow, and the MapLibre adapter: gl-atlas.ts (GlAtlas facade) over
                        gl-setup, gl-camera, gl-hover, gl-picking, gl-compare, gl-styling, gl-view-sync (+ gl-host, gl-geo, gl-style).
                        No React, no features.

app/shared/             imports nothing from features/engines/routes
  components/           Flag
  layout/               sheet (bottom-sheet state), viewport
  lib/                  format, keyboard, seo, site, theme
  styles/               tokens.css, base.css (global) + small shared stylesheets by purpose (layout, panels, sheet, buttons, content, ...), see structure.md "CSS"

app/**/*.test.ts        unit tests, next to the code they test (vitest; npm run test:unit)
```

Framework mode replaces `index.html`/`main.tsx`/`App.tsx` with `root.tsx`,
`entry.client.tsx` and `routes.ts`; nothing is missing. See `docs/architecture.md`.


**Hover tooltip.** The `.tip` shows on every hovered country (and capital ring), whether or not MapLibre has placed its name, and follows the pointer (14/18 px below-right). `GlAtlas` calls `onHover` when the country/ring changes and `onPointer` on every move inside one country; the hook moves the element's left/top in the DOM, no React re-render. A user camera move (drag, wheel) still drops the hover while it runs, but when it comes to rest `GlHover.repick()` hovers whatever is under the last known pointer, so the visitor never has to wiggle the mouse. Hover and selection change feature state only.

**Sidebar Up and collapse.** Both desktop sidebars have their collapse button at the **bottom**. A collapsed sidebar leaves a large solid-brass expand tab centred vertically on the screen edge (`.sidebar-edge-tab`, 40px gap `--rail-gap` / `--panel-gap`). The left rail has no other buttons. **Up lives on the right panel only** (`features/map/components/UpButton.tsx`, arrow + "Back", set like the header eyebrow on its first line; desktop only, phone unchanged). It is a fixed hierarchy, never browser history (`app/features/map/up.ts`): Quizzes `/quizzes` (no button) > subject / History country list / a country's quizzes > a quiz's start screen > an active run or its results (a route registers that in-route level with `useUpStep`; Up resets to the start screen, nothing saved, there is no abandon confirmation); History `/history` (no button) > `/history/:slug` > an opened entry (state; closes first). Everywhere else — map, country pages, Questions (one screen, no levels), each section root — there is no button. Alt+Left is not bound. On desktop the old "Quizzes" / "Back to quizzes" buttons are hidden (`.desk-hide`, the exact complement of the phone query) and kept on phone; the History fill quiz shows Pause only while a run is active.
