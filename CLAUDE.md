# Zemya — working instructions

Read this before touching anything. It records decisions already made so they don't get
relitigated each session.

## What this is

An interactive atlas for learning geography (later: history), built around one idea —
every subject has a natural spatial index, and you learn by navigating it. Geography's
index is the map; history's is the timeline. They share one data model. Events happen in
places.

Owner: Kiril (@kirilchobansky). Solo project. Bulgarian; "Zemya" = Земя, earth.

## Where this is

Updated every commit. One place that answers "what works, what's next" — read this
before reconstructing it from `git log`.

**Working:**
- The atlas: canvas map at full 1:10m unsimplified coastline detail, search, neighbour
  highlighting, true-size compare tool, 5 choropleth overlays plus a mastery overlay.
- Renders off-screen world copies and off-screen features culled before fill/stroke, and
  paints from a coarse (detail 0.006) geometry payload while the full 1:10m one loads in
  the background and attaches in place — see "## Performance" for the target, the
  measuring tool (`npm run perf`) and why this sandbox's hardware doesn't reproduce the
  bottleneck that motivated it. Surfaced a real bug along the way (a country's label
  anchor computed once from coarse geometry and never refreshed once full geometry
  arrived) caught by the real smoke test, not by type or unit tests — see
  `topology.ts`'s `finalizeFeature`.
- 197 countries (see "What counts as a country" below), each hand-authored in
  `content/` and joined against `world-countries` + Natural Earth at build time,
  including Kosovo, Micronesia's currency and Somaliland/Baikonur/Northern Cyprus/the
  UN buffer zone/Akrotiri/Dhekelia/Guantanamo Bay/the Siachen Glacier (absorbed into the
  country whose territory they are, not drawn as holes — see `ABSORB` in
  build-content.mjs), and every country that crosses the antimeridian (Russia, the USA,
  Kiribati, Fiji, New Zealand) rendering and flying-to correctly.
- Every country with polygons draws as a real shape once you're zoomed in far enough to
  see it, not just the large ones — pin-vs-shape is a per-frame decision from on-screen
  width, not a fixed property. Malta and Singapore confirmed by rendering the actual
  shipped code through node-canvas (Playwright still can't launch here). Vatican City is
  a known exception — see Known rough edges.
- The Caspian Sea renders as water, not a hole through to the page background — pulled
  from a hole already present in world-atlas's separate land layer, no new dependency.
  The Great Lakes, Lake Victoria and Lake Baikal are not (see Known rough edges).
- Capital cities as a map layer: 197 `places` (`{ name, iso3, kind: 'capital', lon, lat,
  population }`) in both geometry payloads, drawn as a hollow ring (never the filled
  circle micro-state pins use) above `CAPITAL_DOT_ZOOM_FACTOR` (2x homeZoom) with the
  name beside it above `CAPITAL_LABEL_ZOOM_FACTOR` (5x), a "Capitals" toolbar toggle
  (default on), hover tooltip with the city name, and click selecting the *country* (no
  city page). Suppressed entirely under `quizMode`. See "## Places and capitals".
- Real flag images (`public/flags/`, from svg-country-flags, offline, emoji fallback on
  error) at their own true aspect ratio. `flag-icons`, which normalised everything to
  4:3, is gone. Every one of these SVGs' root element carries only a `viewBox`, no
  width/height — `scripts/build-content.mjs` injects both onto the file itself (from the
  viewBox) before it's written to `public/flags/`, and separately emits the same ratio as
  `flagRatio` on the country record. **Both matter, for different reasons**: the injected
  width/height give the `<img>` a real intrinsic size, which is what CSS auto-sizing
  actually needs to not collapse to zero (see the incident below); `flagRatio` is what
  `Flag.tsx` uses to compute an explicit, definite pixel width AND height in JS for each
  size box, rather than leaning on the browser's own auto-sizing algorithm at all. A first
  version tried to fix this with CSS alone (`aspect-ratio` + `max-width`/`max-height`,
  `width`/`height` left `auto`) and shipped every flag invisible everywhere in the app —
  computed to zero height silently, no console error. It looked fine in the generated
  HTML (a plausible `style="aspect-ratio:…"` string) and passed
  `typecheck`/`build`/`test:unit`, and even the Playwright smoke test's flag assertion,
  which only checked `img.naturalWidth > 0` (the decoded resource's own size) rather than
  `clientWidth`/`clientHeight` (the actual on-screen box) — the two are not the same
  thing, and only the second one was zero. Fixed by injecting real intrinsic dimensions at
  the source AND computing both rendered dimensions explicitly in JS; the smoke test's
  flag checks now assert `clientWidth`/`clientHeight` too. Lesson for next time a sizing
  bug is this suspicious: **check
  `clientWidth`/`clientHeight` on the actual element, not just that the network request
  succeeded or a plausible-looking style string got emitted** — and see the Playwright
  workaround under Known rough edges below, since this bug is exactly why "the tests
  passed" stopped being reassuring enough.
- Progress and scheduling: FSRS cards per (country, facet), created lazily, mastery
  derived never stored, IndexedDB via Dexie, export/import/reset.
- Study mode: 9 question kinds, session policy (due cards first, then new cards
  population-weighted, never the same country twice in a row), a religion-specificity
  taxonomy so distractors can't be a parent/child of the correct answer, and a
  `disputed:` mechanism so a genuinely contested fact (Nigeria's religion) is shown but
  never quizzed and never counts against mastery.
- Solo git workflow: commits go straight to `main`, no branches, no CI (removed
  on purpose — see Git conventions).
- Country name matching (`aliases` on every country record, built at build time from
  world-countries' altSpellings/common/official name; matched in
  `app/lib/geography/names.ts`) and the "Name the Country" quiz, including its results
  screen, a `quizRuns` personal-best history and feeding the FSRS `location` card on
  every answer — see Quizzes below.
- Run history on the quiz catalogue: clicking a size's best time opens its past runs
  (date, time, first-try/revealed) with a delete control per row — the owner's own data
  about their own performance, removable without a console. `resetAll()`,
  `exportAll`/`importAll` and `saveQuizRun`'s impossible-run guard now all cover
  `quizRuns` too — see the new note under Progress and scheduling.
- The quiz run screen (queue, timer, pause/resume, abandon, grading, results, personal
  best) is a shared, subject-agnostic engine (`app/lib/quiz/engine.ts`) behind one route
  (`routes/quiz.$quizId.tsx`, `/quiz/:quizId/:scope/:size`) — a second quiz is one
  `QuizDefinition` entry in `app/lib/geography/quizzes.ts`'s `QUIZ_DEFINITIONS`, not a new
  route tree. "Name the Flag" is that second quiz: a flag fills the whole stage area (no
  map), typing the country grades `geo:<ISO3>:flag`, and a small curated list
  (`content/geography/confusable-flags.yaml`) accepts a few flags that are still
  genuinely hard to tell apart (Romania/Chad) for each other, with a note on the real
  difference — see Quizzes below for the mechanism and the design calls made along the
  way.
- Continent scopes on every quiz: a row of chips (World · Africa · Asia · Europe · North
  America · South America · Oceania, from each country's `region`/`subregion`) in each
  quiz's block on the catalogue, a size ladder computed from the pool by one rule,
  personal bests keyed by (quiz, scope, size) with every pre-scope run still counting as
  World — see Quizzes below. The catalogue's quiz
  titles are 28px Fraunces in `--sea`, the whole size card is the link (hover and
  keyboard focus show a `--sea` border), and the flag no longer has a hairline border
  (it drew a false rectangle round Nepal's pennant).
- Quiz layouts hold still: catalogue size grids reserve their tallest height, the flag
  quiz's flag sits in a fixed box, and answer/note slots are reserved — the typing field
  and the panel buttons stay at the same pixel for all 197 flags, reveal and twin notes
  included (see Quizzes).

**Next:**
- The `location` facet still has no question kind — it needs map-click interaction,
  which is why `ASKABLE_FACETS` filters it out rather than removing it from
  `applicableFacets()`. This is the next piece of study mode, not a bug.
- The study-mode hint (reveals one wrong option, downgrades a correct answer to FSRS
  Hard) was a judgement call, not something requested in detail — confirm with the
  owner it's the right shape before building more on top of it.
- The Great Lakes, Lake Victoria and Lake Baikal still render as holes. Getting them
  needs Natural Earth's `ne_10m_lakes` (a 2.3 MB shapefile covering thousands of lakes
  worldwide, not bundled in `world-atlas`), filtered down to the handful worth drawing —
  investigated and punted for now rather than adding a new dependency or a build-time
  network fetch on a unilateral call. If this is worth doing, it needs: (a) a decision on
  parsing the Shapefile — new dependency vs. a hand-rolled binary reader in
  build-content.mjs — and (b) a one-time fetch step this project has never had before.

**Known rough edges:**
- `npm test` (the Playwright smoke test) needs Chromium's runtime shared libraries,
  which this sandbox doesn't have installed system-wide and there's no passwordless sudo
  to `apt install` them with. **This is now solvable without root**, though — worked out
  while chasing the invisible-flags bug (see below), where "the tests passed while the
  bug was live" made a real browser run non-optional. `apt-get download <pkg>` fetches a
  `.deb` to the current directory as a plain user (it only needs read access to the apt
  lists, not install privileges), and `dpkg-deb -x <pkg>.deb <dir>` extracts it without
  touching the system. `npx playwright install-deps --dry-run chromium` lists 28 "missing"
  packages, but that count is for the full X11/Xvfb/font stack a real display needs —
  Chrome's own headless mode only actually `dlopen`s a handful of them. In practice, three
  were enough to get `chromium.launch()` working end to end:
  ```bash
  mkdir -p /tmp/pwlibs && cd /tmp/pwlibs
  apt-get download libnspr4 libnss3 libasound2t64
  for f in *.deb; do dpkg-deb -x "$f" extract; done
  export LD_LIBRARY_PATH=/tmp/pwlibs/extract/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
  CHROMIUM_PATH=<path from `npx playwright install chromium`'s "Install location"> npm test
  ```
  (found by launching, reading the next `error while loading shared libraries: libX.so`,
  downloading that one package, and repeating — did not need to guess the full list up
  front). This environment variable only lasts the shell session; a future session hitting
  the "Chromium is missing shared libraries" error should try this before assuming `npm
  test` is unavailable and falling back to the substitute checks below.
- Node-canvas is still not a real substitute for a browser when this shortcut isn't
  available for some reason: `typecheck` + `build:content` + `react-router build` +
  `test:unit`, plus a real render of the affected geometry through node-canvas for
  anything visual, catch most regressions but not a CSS layout bug — the invisible-flags
  incident (see "Where this is") shipped past every one of those checks, including a
  passing `test:unit` and a passing (wrongly-asserting) smoke test, and was only visible
  once an actual browser laid out the page. The installed node-canvas version (3.2.3,
  added and removed again with `--no-save` — it is not a dependency) also turned out not
  to implement Path2D at all, so the quiz's "no labels leak the answer" requirement is
  instead verified with a mocked 2D context asserting `fillText`/`strokeText` are never
  called under `quizMode` (`test/unit/renderer.test.ts`) — a stronger, deterministic check
  where it applies, but still no substitute for a real layout engine.
- Vatican City's 1:10m source geometry (world-atlas, one arc, 3 points, all at the same
  longitude) is degenerate — a zero-width line, not a polygon — so it stays a pin at any
  zoom regardless of the pin/shape fix above. Confirmed it's the only one of the small
  states checked with this problem (San Marino, Monaco, Liechtenstein, Nauru all have
  real if small polygons). A data gap, not a rendering bug; not worked around.
- README.md's licensing section still frames repo visibility as a future decision
  ("before this repo is made public"); the Locked decisions table below already
  settled that the repo is public now. Left alone deliberately — visibility and
  licensing are different decisions, and only the first is actually locked.

## What counts as a country

197 entities: 193 UN member states, plus Vatican City and Palestine (UN permanent
observers), plus Taiwan and Kosovo.

The rule: de facto control of territory, its own capital and its own borders, AND
meaningful international recognition. That admits Kosovo (recognised by about 115
states) and Taiwan (11 states, plus de facto economic relations with nearly everyone).
It excludes Somaliland (recognised by none) and Northern Cyprus (recognised only by
Türkiye) — both of which meet the de facto test and fail the recognition one. It also
excludes Greenland, Hong Kong, Macau and Puerto Rico (not self-governing states) and
Western Sahara (no effective control of its territory).

This is an editorial line, not a fact. Recognition counts are approximate and change;
the line is written down so it stays consistent, not because it is objective.

Excluded territories are drawn, dim and unclickable, so the map has no holes — except
the ones listed below, which are drawn as part of the country whose shape they are.

### Absorbed territories

Somaliland, Northern Cyprus and a handful of smaller cases are not drawn as separate
dim shapes: their geometry is merged into a real country's at build time, so the map
never shows a hole where recognised territory should be. "Merged" means the shared
borders are dissolved (`topojson-client`'s `mergeArcs`, a devDependency — it was already
installed transitively), so Somalia and Cyprus are each one polygon with no line through
them and are clicked as one. Merely appending the neighbour as a second polygon used to
leave its border arcs in place and the stroke pass drew them. The full list, and the reason
for each, lives in `scripts/build-content.mjs`'s `ABSORB` map — Somaliland into Somalia,
Baikonur into Kazakhstan, Northern Cyprus/the UN buffer zone/Akrotiri/Dhekelia into
Cyprus, Guantanamo Bay into Cuba, the Siachen Glacier into India. If Somalia looks like
it's missing its north-west again, or Kazakhstan has a hole in the middle again, look
there before touching the geometry-matching code — the fix is a map entry, not a
special case in `topology.ts`.

## Locked decisions — do not reopen without asking

| Decision | Choice | Why |
| --- | --- | --- |
| Platform | Web, PWA-installable | Install friction kills education tools. Deep links are the only free acquisition channel. |
| Framework | React 19 + Vite 8 + TypeScript + React Router **v8** (framework mode) | Owner already knows React. The perf-critical part is canvas, which is framework-agnostic. Framework mode pre-renders, so `/country/bulgaria` is a crawlable document. (v8, not the v7 first discussed — v8 is current and the config is the same shape.) |
| Hosting | Cloudflare Pages, fully static | No server needed. Free. Preview URL per PR. |
| Backend | **None for now** | Ship without accounts. Local-first from day one so adding sync later costs nothing in perceived speed. |
| Storage | IndexedDB via **Dexie 4.4.6**, local-first | Every interaction must be 0 ms. Never block UI on network. |
| Scheduling | **ts-fsrs 5.4.2** (FSRS), not SM-2, not the prototype's 3-in-a-row toy | Modern open algorithm, real intervals and due dates. MIT, open-spaced-repetition org, actively maintained — checked before pinning. |
| Map engine | Custom canvas renderer, **not** Leaflet/MapLibre. Coastlines are **1:10m, unsimplified** (~3.4 MB raw, 687 KB gzipped) | Tiles need a network; a vector-only engine gives true-size re-projection and exact hit-testing for free, and does the pedagogical things a general-purpose library makes harder. Revisit only when city/street detail is actually wanted. Measured before shipping unsimplified: paints in ~585 ms, pans at a solid 60 fps. |
| Repo visibility | Public | Made public so this sandbox can read it. Secrets still never enter the repo. |

## Structure

```
prototype/              frozen reference build — read it, port from it, never develop in it
content/geography/      hand-authored YAML, one file per country. THE MOAT.
scripts/                content/ + upstream datasets -> public/data/
app/root.tsx            the HTML document itself + the top-level App
app/routes.ts           the route table
app/entry.client.tsx    hydrates the prerendered document
app/entry.server.tsx    renders each route to HTML at build time
app/lib/core/           scheduler + Dexie store. subject-agnostic; no geography imports.
app/lib/map/            projection, topology, camera, renderer, controller. no React.
app/lib/geography/      overlays, client payload loader, *.server.ts catalog readers,
                        mastery derivation
app/lib/format.ts       shared formatting and normalisation
app/components/         Rail, SearchBox, and future panels
app/routes/             atlas.tsx (layout, owns the canvas) + panel routes
app/styles/             tokens.css then app.css
public/data/geography/  generated, committed on purpose
public/flags/           generated from flag-icons, committed on purpose
test/smoke.mjs          end-to-end browser test against the production build
```

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

Rules that follow from this layout:

- `content/` must stay editable by a non-programmer. Plain YAML/text, no code, no build
  step required to read it. It may move to its own repo later — don't couple it to `src/`.
- Generated data is **committed**, not built at deploy time. A content edit shows up as a
  diff in both `content/` and `public/data/`.
- `app/lib/map/` must not import React or anything from `app/lib/geography/`. It is a
  standalone renderer; the globe projection and the history timeline will both reuse it.
- `app/lib/core/` must not import from `app/lib/geography/`, or anything geography-specific
  at all. Card ids are opaque strings to it; history will use the same store one day.
- Anything reading `public/data/*.json` from disk lives in a `*.server.ts` file, so the
  bundler strips it from the client. A 154 KB catalogue must never ship to a browser
  twice.
- Route loaders run at **build time** — every page is prerendered. Node APIs are fine in
  them; `window` is not.

## Interaction principles

> The camera moves only when the user could not already see the target. Clicking a country
> on the map never moves the camera; arriving from search, a link, or a cold URL does.
> Any new way of selecting a country must decide which of those two it is.

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
| Wheel, drag, pinch, double-click | unchanged |

Intent travels as React Router location state: `state={{ fly: true }}` on a `Link`,
`{ state: { fly: true } }` on `navigate()`. The map's own click handler passes nothing.
`flyTo` and `home` on the Atlas controller are unchanged by this rule — it governs who
calls them, not what they do.

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

**Zoom constants** (`renderer.ts`, multiples of `homeZoom`, chosen by eye in a real browser
zooming from the world view into Central Europe): `CAPITAL_DOT_ZOOM_FACTOR = 2`,
`CAPITAL_LABEL_ZOOM_FACTOR = 5`. Capitals appear at *less* zoom than micro-state shapes
because a micro-state only turns from pin into shape once its own width passes
`PIN_MAX_WIDTH` (7 px) — Malta/Singapore-sized countries need roughly 3.5x-5x, Monaco and
San Marino far more, Vatican City never — whereas a ring needs no shape to be readable.
At 1.6x the map is countries and pins only; at 2.2x rings are legible (the Balkans dense
but not a smear); at 4-5x rings with no names; from 5x names fit beside their rings without
touching country labels. Not tested below 2x/5x once those looked right — "good", not
"optimal".

**Labels compete with country labels** for one collision list (`drawLabels` fills it with
country names first, larger claim, then `drawPlaceLabels` adds cities by descending
population), so a city and a country name can never overlap; the loser is simply not drawn
until there is room. A capital whose country is drawn as a pin within 6 px of the ring
skips its ring (the pin already marks it).

**`quizMode` suppresses place rings, place labels and place tooltips/hit-testing**, through
the same one flag (`capitalsVisible()` is the single predicate drawing, labels and
`pickPlace()` all share, so they cannot disagree). A capital label at quiz zoom prints the
answer next to the dot.

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

## Quizzes

The owner's own words on why this exists: "the reason i want this app is the quizzes
actually. Not the detail not anything else." — treat this as the app's core loop, not a
feature alongside the atlas and study mode.

**Route shape.** `/quiz` (`routes/quiz.tsx`) is the catalogue — a list built from
`app/lib/geography/quizzes.ts`'s `QUIZ_DEFINITIONS`/`QUIZ_SIZES`. Every run, of any quiz,
is served by one route: `/quiz/:quizId/:size` (`routes/quiz.$quizId.tsx`), which looks the
id up in `QUIZ_DEFINITIONS` and renders that definition's `Stage`. A second quiz ("Name
the Capital", say) is one new `QuizDefinition` entry, never a new route tree or a rewrite
of the catalogue page — this is what let "Name the Flag" arrive as a ~50-line presenter
(`components/quiz/FlagsStage.tsx`) plus a registry entry, reusing everything else. Sizes
come from `app/lib/geography/scopes.ts` (see Scopes below), ranked by population within
the selected pool (`topByPopulation` — kept behind one function so ranking by a different
axis later is a one-line change); a quiz that shouldn't rank by population would pass its
own list into the shared engine instead.

**Scopes.** Every quiz has a continent filter, in the shared catalogue and engine, not
per quiz. Route: `/quiz/:quizId/:scope/:size`, scope one of `world | africa | asia |
europe | north-america | south-america | oceania`; the pool is
`poolForScope(countries, scope)` (`region`, plus `subregion` to split the Americas: South
America is the subregion, North America is every other Americas country — 197 / 54 / 48 /
46 / 23 / 12 / 14), and "top N" means the N most populous *within* that pool. The old
`/quiz/:quizId/:size` still exists as `routes/quiz.legacy.tsx`, a redirect to the world
scope, and is prerendered for the old sizes so bookmarks to a static host still resolve. A
removed scope key (`LEGACY_SCOPES` in `scopes.ts` — today just `americas`, split in two)
redirects to its replacement (world) and is prerendered for the sizes it once offered; a
size the pool can't offer (typed into the URL by hand) redirects to `/quiz`.
`scopes.ts` is deliberately dependency-free (no `~` alias, no React): `react-router.config.ts`
imports it directly to derive the prerendered `/quiz/:id/:scope/:size` set from
`countries.json`, so adding a country changes both the offered sizes and the prerendered
pages with no list to edit. The catalogue reads the same pool sizes from a build-time
route loader. A new quiz is one id in that config's `QUIZ_IDS` plus its
`QUIZ_DEFINITIONS` entry.

**The size ladder is computed, never listed.** `sizesForPool(N)` keeps a rung S of
`[10, 20, 30, 50, 90, 120]` when `0.08 * N <= S <= 0.68 * N`, and always appends All. The
lower bound (`MIN_SHARE`) drops a size that is a trivial slice of the pool — why World
doesn't offer "top 10 of 197". The upper bound (`MAX_SHARE`) drops a size so close to All
it is the same quiz twice — why Oceania and South America offer only All. The table it
yields is asserted in the unit test, not stored: World 20/30/50/90/120/All, Africa, Asia
and Europe 10/20/30/All, North America 10/All, South America and Oceania All. (This
replaced an earlier rule — strictly smaller than the pool, plus a special case keeping 10
off World — which had to be patched by hand.)

**Personal bests are keyed by (quizId, scope, size).** `quizRuns` rows written before
scopes existed have no `scope` field. They are read as `'world'` at read time
(`runScope` in `progress.ts`), never migrated or rewritten: filtering strictly on scope
would silently hide every existing best time, and every one of those runs really was a
world run. New rows always write `scope`; the export/import dedupe key includes it (with
the same missing-means-world default). `useQuizEngine` therefore takes a `scope` argument
alongside `size` — the one engine change this needed. A stored scope that no longer
exists matches nothing and never throws: **personal bests recorded under `americas` are
orphaned** — that scope was split, a run can't be attributed to either half, and the rows
are left in the table (not deleted, not migrated).

**The engine/presenter split.** `app/lib/quiz/engine.ts`'s `useQuizEngine()` hook owns a
run end-to-end — question order, the current target, attempt state, timer accumulation,
pause/resume, abandon, per-answer outcome, completion, the results payload, the
personal-best write and FSRS grading — and is deliberately ignorant of maps, flag images
or anything else a Stage renders; it knows a list of countries and a callback per answer.
A `QuizDefinition` (`app/lib/quiz/types.ts`) is `{ id, title, description, facet, Stage,
prepare?, match? }`: `facet` says which FSRS card an answer grades
(`geo:<ISO3>:<facet>`), `Stage` is the component that renders what the player sees,
`prepare(targets)` is an optional lookahead hook for preloading something heavier than a
name (the flags quiz preloads SVGs three questions ahead — the heaviest are 200+ KB and a
mid-run hitch would feel broken), and `match(typed, target)` is an optional acceptance
rule layered on top of the plain name match every quiz gets for free (see confusable
pairs below). `description` and `match` aren't in the minimal shape first sketched for
this split; both turned out to be needed once the catalogue text and the flags quiz's
confusable pairs were actually built, so they're recorded here rather than only in a
commit message.

`routes/quiz.$quizId.tsx` is the "atlas bridge": it owns the handful of things every quiz
needs from the atlas layout — hiding the search box/toolbar/tooltip for the run's whole
lifetime, returning the camera to the world view on START and on finish, and mirroring
the run's target/answered/showNeighbours/paused state into the map's own quiz-mode
painting. This happens unconditionally for every quiz, including one whose Stage never
shows the map (flags) — harmless there, since nothing is looking at the map underneath a
full-stage overlay, and it means the atlas-integration code is written once rather than
per quiz. `QuizStageProps` has a `slot: 'stage' | 'panel'` a Stage is called with twice
per render: `'stage'` is the thing docked or overlaid on the canvas (the countries quiz's
START/input dock; the flags quiz's full-stage flag + input), `'panel'` is anything extra
a quiz wants inside the right panel alongside the generic timer/count/action buttons —
today only the countries quiz uses it, for its neighbour-glow toggle, since no other quiz
has a notion of map neighbours. This `slot` prop is how a one-off control like that gets a
home without `QuizStageProps` growing a bespoke field per future quiz.

**Quiz mode is one flag, not four conditionals.** `routes/quiz.$quizId.tsx` reaches the
map through `useAtlasContext()` (exported from `routes/atlas.tsx`) and writes a `quiz:
QuizOverride | null` there for the whole lifetime of the route (set on mount, torn down on
unmount), for every quiz alike — `quiz.tsx`'s catalogue never touches it. Setting it
non-null does these things, all gated on that one value: the renderer's `Style.quizMode`
suppresses `drawLabels()` entirely — country AND capital names — and the capital rings and
their hit-testing (`renderer.ts`); `atlas.tsx` stops rendering the search box and the hover
`.tip` (which is also where a capital's tooltip would show); and the neighbour glow defaults off, driven by
`quiz.showNeighbours` rather than the normal toolbar's `showNeighbours` state (only the
countries quiz's Stage renders a toggle for it — see the engine/presenter split above).
Fill/stroke while active come from `quizFillFor`/`quizStrokeFor` (`geography/overlays.ts`)
instead of the normal `fillFor`/`strokeFor` — answered-correct green, answered-revealed
amber, the current target brass, everything else plain land; no overlay, hover or mastery
colouring applies mid-quiz. Anyone adding a fifth surface that could show a country's name
should gate it on this same `quiz`/`quizMode` value rather than inventing a new flag.

**Nothing moves when content changes size.** The player's eyes and hands are anchored on
the input, so no Stage may change its position, ever. The flag lives in a fixed 460x300
box (`.quiz-flag-stage__flag`) — only the flag inside it changes size (Qatar fits by
width, Nepal by height) — and the revealed-answer chip and the panel's accepted-twin note
each have a slot of reserved height (`.quiz-feedback`, `.quiz-run__note-slot`) that is
always present and simply empty. New quiz Stages follow the same rule. The catalogue
follows it too: each quiz's size grid reserves the height of the tallest grid any scope
can produce (`--max-rows` from the data x `--card-h`), so a chip that shrinks one quiz's
grid never shoves the quiz below it. Checked by clicking every chip and by skipping
through all 197 flags and comparing the input's box.

**Camera: little to no zoom, on purpose.** The first version of this flew the camera to
each question with custom quarter-viewport-width framing (`camera.ts`'s `frameForQuiz`,
reading a `feature.mainBbox` built from clustering a country's polygons so a remote
exclave like Chile's Easter Island didn't drag the frame out over open ocean). The owner
overruled this after using it: the per-question zoom was too aggressive, and the point is
to keep the sense of the whole world, not to be flown around it question by question. That
whole mechanism (`frameForQuiz`, `Atlas#flyToQuiz`, `feature.mainBbox`, the polygon
clustering in `topology.ts`) was removed rather than left dead. **A run now calls
`atlas.home()` once, on START, and never moves the camera again on its own** — the map
sits at (roughly) the world view for the whole run; the user's own pan/zoom is untouched.
The current target is marked with `Atlas#setFocus([target])` instead (pre-existing,
previously-unused infrastructure) — `renderer.ts`'s `drawPins` gives a focused feature
drawn as a pin a bigger radius, and under `quizMode` specifically, a much bigger radius
plus an outer halo ring in the target's own colour, since at a near-world zoom a
Monaco-sized pin would otherwise be nearly invisible. Real shapes (large countries) need
no such treatment — the brass fill/stroke from `quizFillFor`/`quizStrokeFor` already
reads fine at any zoom.

**Map clicks are inert during a quiz.** `atlas.tsx`'s `handleSelect` (which normally
navigates to a country's dossier) returns immediately whenever `quiz` is set. Before this
guard existed, clicking the map mid-run — easy to do by accident once the per-question fly
was removed and the whole world is visible and clickable — would navigate away, unmount
the run, and silently lose it with no confirmation. This is the same category of bug as
the pause one below: an interaction the quiz doesn't own reaching in and clobbering it.

**Pause/resume: never `disabled` the input.** The run input used to get the HTML
`disabled` attribute while paused. A disabled element cannot hold keyboard focus at all —
so the second Esc a player pressed, aimed at resuming, reached no handler, and the run
looked permanently stuck (the owner's actual bug report). Escape is now a `window`-level
listener active in both `running` and `paused`, independent of what has focus; the input
itself is only *visually* dimmed (`.quiz-dock__input--paused`) and its keystrokes are
ignored in `handleInputChange`'s own phase check, so it stays focused and every shortcut
keeps working. General lesson: a keyboard shortcut that is supposed to escape a state must
not be attached only to a DOM node that state disables.

**Abandon.** `Ctrl+Backspace` (also a button) quits a run outright — nothing saved, no
`quizRuns` row, no FSRS grading for anything answered so far — and returns to `/quiz`.
Deliberately just a `navigate('/quiz')`: the route unmounting is what already tears the
`quiz` override down (see its mount effect), so there is no local state to reset first.
Not a bare key, and not Esc (already pause) — a bare letter would fire while typing a
country's own name (e.g. "Qatar").

**Feeding the spaced repetition.** Every answer grades that country's
`geo:<ISO3>:<definition.facet>` card (`app/lib/geography/mastery.ts`'s `cardId`) through
the normal `review()` from `useProgress()` — the same path study mode uses. For the
countries quiz that's `location`, graded here even though study mode still can't ask it
(`ASKABLE_FACETS` excludes it) — that's intentional, the quiz *is* the location question,
so don't "fix" it by adding a location question kind to study mode instead. The flags
quiz grades `flag` instead, feeding the same card study mode's flag questions already use.
Rating: revealed -> Again; not revealed but skipped at least once -> Hard; answered clean
and fast (under 5 s of the country last becoming the target) -> Easy; answered clean
otherwise -> Good. "Fast" is measured from when the country MOST RECENTLY became the
target, not first — the two are the same instant for any answer that was never skipped,
i.e. every Easy/Good case, so this only matters for telling Hard apart, where it already
resolves to Hard regardless of elapsed time.

**"Name the Flag" and confusable pairs.** Same engine, same six sizes, same top-N-by-
population ladder, same keyboard rules, same matcher, same timer, same results and
personal best — its `QuizDefinition` (`app/lib/geography/quizzes.ts`) is a `Stage`
(`components/quiz/FlagsStage.tsx`, no map, the flag filling the stage area with the
input directly under it), `facet: 'flag'`, a `prepare()` that preloads the next three
flags' SVGs, and a `match()`. True aspect ratios (see "Where this is") solve most
lookalikes outright — Monaco vs Indonesia is a real shape difference now, not just a
colour one — but a very short list of pairs are still genuinely unfair even so. The list
lives in `content/geography/confusable-flags.yaml` (plain YAML, hand-curated, one entry
today: Romania/Chad), because generating it from a pixel comparison was tried and
over-reports badly — it ranked Egypt/Iraq as the closest pair in the set, which is only
true at thumbnail size where their emblems blur away. `build-content.mjs` resolves each
pair by country name and denormalises the OTHER side's `aliases` and a shared `note`
directly onto both countries' `confusableFlag` field, so `quizzes.ts`'s `match()` can
accept the twin's name and explain the real difference (`"Accepted — that one was
<target>. <note>"`) without a second catalogue lookup at match time. Keep this list short
and only grow it from real play.

**Personal best.** Every finished run is appended (never overwritten) to a `quizRuns`
table in the same Dexie database as `cards`/`reviews` (`app/lib/core/progress.ts`) —
`bestQuizTime()` reads the fastest for a given quiz+size, shown on the catalogue's size
cards and on the results screen ("beat your best" / "personal best stays"). Deliberately
left out of the JSON export/import format: a personal best is local flavour, not learning
progress, and folding it in would force `SCHEMA_VERSION` to move over an additive table.
Revisit if the owner wants best times to survive a device move.

**Results screen.** On the last correct answer the camera pulls back to the world view
(`atlas.home()`) while the finished map stays coloured (green/amber, from the `quiz`
override, which is only cleared on unmounting the route) and the panel shows the time,
the personal-best comparison, a first-try-vs-revealed tally, and every revealed country
as a dossier link — "the ones worth another look", the actual point of the screen.

## Commands

```bash
npm install
npm run dev             # dev server on :5173
npm run build           # build:content, then prerender 262 static pages
npm run build:content   # content/ -> public/data/geography/
npm run typecheck       # react-router typegen && tsc --noEmit
npm test                # serves build/client and drives a real browser
npm run test:unit       # vitest — pure-logic tests (scheduler, mastery), no browser
npm run perf            # serves build/client, drives a real browser, reports frame time
```

Prerendered pages: 197 countries, the atlas/study/quiz index pages, and every valid
`/quiz/:id/:scope/:size` (25 per quiz today) plus the legacy `/quiz/:id/:size` redirects.

`npm test` requires a completed `npm run build`. In this sandbox pass
`CHROMIUM_PATH=/opt/pw-browsers/chromium`.

`npm run test:unit` needs no build — it exercises `app/lib/core/` and
`app/lib/geography/mastery.ts` directly, importing real content through the same
`catalog.server.ts` reader every route loader uses. `test/unit/progress.test.ts` is the
one exception that needs a real IndexedDB to exercise `progress.ts`'s actual Dexie code
(rather than the `available() === false` no-op path) — it pulls in `fake-indexeddb`
(devDependency only, `fake-indexeddb/auto` imported at the top of that file) rather than
mocking Dexie by hand.

(In `prototype/`: `npm install && npm run build`.)

## Performance

**Target: 16.7 ms median frame time (60 fps) at world zoom, full pan/zoom, with full 1:10m
coastline detail preserved when zoomed in.** Detail is not the thing to sacrifice — it's
visible and was asked for. What has to go is drawing detail nobody can see on screen.

`npm run perf` (`test/perf.mjs`) checks this: it serves `build/client`, opens a real
browser at 1500x900, waits for the map to paint, then simulates a pan (90 synthetic
`pointermove` events across the canvas) while sampling `requestAnimationFrame` deltas. It
reports time-to-painted-map and median/p95/worst frame time. **Any change touching
`app/lib/map/` runs `npm run perf` and reports the number in the commit message** — "it
feels smoother" is not evidence.

The owner's own measurements, on their machine, drawing all 197 countries filled and
stroked over the full unsimplified coastline every frame before any of this existed:

| detail | points | frame time | fps |
| --- | --- | --- | --- |
| 0 (full 1:10m) | 463,815 | 74.7 ms | 13 |
| 0.0005 | 161,267 | 37.8 ms | 26 |
| 0.002 | 84,186 | 26.5 ms | 38 |
| 0.006 | 48,603 | 19.0 ms | 53 |

This sandbox's hardware does not reproduce that bottleneck — it already measures
16.7 ms/60 fps at detail 0, before any of the work below — so numbers measured here are
not evidence that a change fixed anything on the owner's machine, only that it didn't
regress here. Report both this sandbox's number and that caveat rather than presenting a
non-reproducing measurement as proof.

**What was built in response** (commits `43396ca`, `3d6ba3e`): (1) cull world copies and
features whose screen-space bbox doesn't intersect the viewport (with margin, so nothing
pops mid-pan) before filling/stroking — pure culling, pixel-identical output; (2) two
geometry payloads, `world.json` (detail 0, full) and `world-coarse.json` (detail 0.006,
~475 KB) — coarse loads first so the map paints fast, full attaches in place in the
background, and the renderer switches per-feature between them at a zoom threshold
(`LOD_ZOOM_FACTOR` in `renderer.ts`). Commit 3 (skip the stroke pass while the camera is
moving, full-quality stroke on release) was scoped but not built: the explicit instruction
was to measure first and skip it if the target was already met, and both commits above
already hit 16.7 ms median on the hardware available to measure with.

**Trap: `npm run build` runs `build:content` first**, which regenerates both geometry
payloads from `content/` and silently overwrites a hand-built test payload (e.g. a
payload edited to test a specific point count or a specific detail level). When measuring
the effect of a specific payload rather than the real content, build with
`npx react-router build` — never `npm run build` — so `build:content` doesn't run first.

Solo project, one machine, one person. No branches, no pull requests, no CI.

- Work directly on `main`. Do not create branches. Do not open pull requests.
- Commit when a change works. Small commits are fine; perfect commits are not required.
- Commit subject: imperative, lower case, no trailing period. One line is enough.
- Before committing, run `npm run typecheck` and `npm run build:content`. If content
  changed, commit the regenerated public/data in the same commit.
- Running the browser smoke test is optional. It is a tool for me, not a gate.
- This sandbox can read the repo but not push. Leave commits unpushed; the owner
  clicks Sync in VS Code.
- If you make a decision the prompt did not specify — a name, a data shape, a
  trade-off, a deviation — record it in CLAUDE.md in the same commit. CLAUDE.md is
  the only channel between this machine and whoever is reviewing the work elsewhere.
  A decision that lives only in a commit message or a chat reply is a decision that
  gets relitigated.
- Update "## Where this is" in every commit that changes what works.

## Visual identity

Committed single dark theme — a chart room, not a generic dashboard. Do not add a light
theme without asking; do not drift toward the default "near-black + one neon accent" look.

Tokens live in `app/styles/tokens.css` and are the single source of truth — except for
`--land` and the micro-state pin, which the canvas renderer needs as literals in
`app/lib/map/renderer.ts`. Change one, change both.

```
--abyss   #080D13   ground, deep sea ink
--chart   #0E1720   panel surface
--chart-2 #14212C   raised surface
--rule    #243543   hairline
--ink     #E6EEF3   primary text
--ink-2   #9FB3C0   secondary text
--ink-3   #67808F   tertiary / labels
--brass   #E8A33D   accent — instrument brass, used sparingly
--sea     #4EA9C9   secondary accent, selection-adjacent
--new     #E2544F   mastery: new
--learn   #E8A33D   mastery: learning
--master  #3DD68C   mastery: mastered
--land    #31485A   default landmass fill
```

Type: Fraunces (display) · Archivo (UI) · IBM Plex Mono (data, labels, timers).
Loaded from Google Fonts with real system fallbacks — the app must stay usable offline,
so nothing may depend on a webfont having loaded.

## Content conventions

- Memory hooks are one sentence, concrete, and surprising. They are not encyclopaedia
  summaries. "Belgium once went 589 days without a government" — not "Belgium is a country
  in Western Europe."
- Flag descriptions describe *geometry and colour* so they can be read aloud without the
  flag visible.
- Outline descriptions describe *silhouette* — the shape as a thing you'd recognise.
- Religion values are deliberately specific (Eastern Orthodoxy, Sunni Islam, Theravada
  Buddhism), not coarse buckets. The faith↔language matching round depends on it.
- Quiz only on falsifiable facts: dates, places, actors, sequence. Never quiz causation.
- Overrides exist only to close upstream data gaps. Each must carry a `note` saying
  why upstream is wrong and how that was established. Never use an override to express
  an opinion — if a fact is disputed, don't quiz it.
- "If a fact is disputed, don't quiz it" has a mechanism, not just a principle: mark the
  facet `disputed:` in the country's YAML with a mandatory reason (see Nigeria's
  religion). A disputed facet is excluded from the question rotation and from that
  country's mastery denominator; the dossier still shows the value, with the reason on
  hover. Reach for this instead of picking a source and asserting precision nobody has.
- Hooks are written as fragments with an implied subject. Any surface that shows a hook
  outside the country's own page must supply the subject itself.
- Accepted names in the quizzes are generated (world-countries' spellings), and corrected
  per country with an `aliases:` block in that country's YAML — `add: [...]`, `remove:
  [...]` and a mandatory `note` saying why. Applied after the ambiguity guard, so an added
  alias may deliberately be shared ("Congo" is accepted for both Congos); `remove` must
  name an alias that exists, so an upstream rename fails the build. Today: Thailand drops
  "Thai" (the people, not the country), the UK adds "UK", both Congos add "Congo".
- `content/geography/confusable-flags.yaml` is the one content file that isn't
  per-country — a hand-curated list of flag pairs the "Name the Flag" quiz accepts for
  each other (see Quizzes). Same rule as everywhere else in `content/`: plain YAML,
  editable without touching code, and a mandatory `note` saying why the pair is genuinely
  confusable, not asserted opinion.

## Do not

- Do not add subjects beyond geography until geography ships and has users. The multi-subject
  vision shapes the *architecture*, not the roadmap.
- Do not add accounts, a database, or any server call in the first release.
- Do not introduce a map tile provider or API key.
- Do not put secrets in the repo. `.env` is gitignored; `.env.example` is committed.
- Do not use `localStorage` as the primary store — IndexedDB, with a guarded fallback.
- Do not hand-write bulk historical content later; seed from Wikidata and hand-write only
  the hooks.
- Do not enable lazy route discovery. A static host has no `/__manifest` endpoint, and the
  404 breaks every client-side navigation silently. `routeDiscovery: { mode: 'initial' }`
  is deliberate.
- Do not change a country's `slug` once shipped. It is a public URL.
- Do not load flags from a CDN. They are local files so the app can work offline and so
  no third party sees which countries the user is studying.
- Do not re-introduce coastline simplification (`--detail`) to quiet micro-island noise
  from the unsimplified 1:10m data. Flag it to the owner instead — see the Map engine row
  above.
- Do not add a Shapefile-parsing dependency or a build-time network fetch to draw the
  remaining lakes (Great Lakes, Victoria, Baikal) without asking first — see "Where this
  is"'s Next section. The Caspian was free; the rest genuinely cost something, and that's
  a decision for the owner, not a default to reach for.
