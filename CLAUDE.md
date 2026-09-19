# Zemya — working instructions

Read this before touching anything. It records decisions already made so they don't get
relitigated each session.

**`docs/` is reference — read the file for the area you're touching (`architecture.md`,
`quizzes.md`, `performance.md`, `decisions.md`); this file is the part that always
applies.** (Four files, not three: quizzes alone was ~300 lines.)

## What this is

An interactive atlas for learning geography (later: history), built around one idea —
every subject has a natural spatial index, and you learn by navigating it. Geography's
index is the map; history's is the timeline. They share one data model. Events happen in
places.

Owner: Kiril (@kirilchobansky). Solo project. Bulgarian; "Zemya" = Земя, earth.

## Where this is

Updated every commit: what works, what's next — read it before reconstructing from `git
log`. The per-feature narrative behind each line is in `docs/decisions.md`.

**Working:**
- The atlas: canvas map at full 1:10m coastline, search, neighbour highlight, true-size
  compare, 5 overlays plus mastery; culled drawing, coarse-then-full geometry load
  (`docs/performance.md`). Real flags at true aspect ratio, offline.
- 197 countries (see below) hand-authored in `content/`, joined with `world-countries` +
  Natural Earth at build time; antimeridian countries and absorbed territories render
  correctly. Vatican City stays a pin (degenerate source geometry). The Caspian is water;
  the Great Lakes, Victoria and Baikal are not.
- Capitals as a map layer (rings 6x, names 9x, off in quizzes) — `docs/architecture.md`.
- FSRS card per (country, facet), mastery derived, Dexie/IndexedDB, export/import/reset;
  study mode with 9 question kinds and `disputed:` facets.
- Three quizzes on one shared engine (Countries, Flags, Capitals): continent scopes, a
  computed size ladder, personal bests and run history, a camera that follows the
  player with the continent as home, still layouts (`docs/quizzes.md`).

- Licensed (MIT code, ODbL data); sources in README, GeoNames credited in the rail footer.

**Next:**
- The `location` facet has no question kind yet (needs map-click interaction), which is why
  `ASKABLE_FACETS` filters it out. The next piece of study mode, not a bug.
- The study-mode hint (drops one wrong option, grades a correct answer Hard) was a
  judgement call — confirm the shape with the owner before building on it.
- The Great Lakes, Lake Victoria and Baikal still render as holes; drawing them needs a
  Shapefile dependency or a build-time fetch — an owner decision (full note in
  `docs/decisions.md`).

**Known rough edges** — `docs/decisions.md`, incl. the no-root recipe for running `npm test`
here (Chromium's shared libraries are missing) and the Vatican City data gap.

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

Absorbed territories (Somaliland, Northern Cyprus, Baikonur, …) are merged into a real
country at build time — the fix for a hole is a map entry in `ABSORB` in
`scripts/build-content.mjs`, never a special case in `topology.ts`. List and reasons:
`docs/decisions.md`.

## Locked decisions — do not reopen without asking

| Decision | Choice | Why |
| --- | --- | --- |
| Platform | Web, PWA-installable | Install friction kills education tools. Deep links are the only free acquisition channel. |
| Framework | React 19 + Vite 8 + TypeScript + React Router **v8** (framework mode) | Owner already knows React. The perf-critical part is canvas, which is framework-agnostic. Framework mode pre-renders, so `/country/bulgaria` is a crawlable document. (v8, not the v7 first discussed — v8 is current and the config is the same shape.) |
| Hosting | Cloudflare Pages, fully static | No server needed. Free. Preview URL per PR. |
| Backend | **None for now** | Ship without accounts. Local-first from day one so adding sync later costs nothing in perceived speed. |
| Storage | IndexedDB via **Dexie 4.4.6**, local-first | Every interaction must be 0 ms. Never block UI on network. |
| Scheduling | **ts-fsrs 5.4.2** (FSRS), not SM-2, not a 3-in-a-row toy | Modern open algorithm, real intervals and due dates. MIT, open-spaced-repetition org, actively maintained — checked before pinning. |
| Map engine | Custom canvas renderer, **not** Leaflet/MapLibre. Coastlines are **1:10m, unsimplified** (~3.4 MB raw, 687 KB gzipped) | Tiles need a network; a vector-only engine gives true-size re-projection and exact hit-testing for free, and does the pedagogical things a general-purpose library makes harder. Revisit only when city/street detail is actually wanted. Measured before shipping unsimplified: paints in ~585 ms, pans at a solid 60 fps. |
| Repo visibility | Public | Made public so this sandbox can read it. Secrets still never enter the repo. |

## Structure

```
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

Framework mode replaces `index.html`/`main.tsx`/`App.tsx` with `root.tsx`,
`entry.client.tsx` and `routes.ts`; nothing is missing. See `docs/architecture.md`.

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
| A new quiz question | moves ONLY if the target isn't already visible — see "Camera: follows the player" |
| Wheel, drag, pinch, double-click | unchanged |

Intent travels as React Router location state: `state={{ fly: true }}` on a `Link`,
`{ state: { fly: true } }` on `navigate()`. The map's own click handler passes nothing.
`flyTo` and `home` on the Atlas controller are unchanged by this rule — it governs who
calls them, not what they do.

## Places, cards and quizzes — the rules; the reference is in docs/

- **Places / capitals** (`docs/architecture.md`): do not add non-capital cities without a
  decision. Rings, labels and hit-testing all go through the one `capitalsVisible()`
  predicate, which `quizMode` turns off. Capital aliases are exact after `normaliseName`;
  a collision throws at build time.
- **Cards** (`docs/architecture.md`): one card per (country, facet), id `geo:BGR:capital`,
  lazy, mastery derived never stored, writes never awaited by the UI. **Every table the app
  writes must be covered by reset, export and import** — all three, same commit.
- **Quizzes** (`docs/quizzes.md`): one engine, one route; a new quiz is a `QuizDefinition`
  plus its id in `react-router.config.ts`'s `QUIZ_IDS`. Anything that could show a
  country's name is gated on the single `quiz`/`quizMode` value. No Stage may move when its
  content changes size. Never `disabled` the run input.

## Commands

```bash
npm install
npm run dev             # dev server on :5173
npm run build           # build:content, then prerender 286 static pages
npm run build:content   # content/ -> public/data/geography/
npm run typecheck       # react-router typegen && tsc --noEmit
npm test                # serves build/client and drives a real browser
npm run test:unit       # vitest — pure-logic tests (scheduler, mastery), no browser
npm run perf            # serves build/client, drives a real browser, reports frame time
```

`npm test` requires a completed `npm run build`. In this sandbox pass
`CHROMIUM_PATH=/opt/pw-browsers/chromium`.

Prerendered pages and what `test:unit` covers: `docs/architecture.md`.

## Performance

**Target: 16.7 ms median frame time (60 fps) at world zoom, full pan/zoom, with full 1:10m
coastline detail preserved when zoomed in.** Detail is not the thing to sacrifice — it's
visible and was asked for. What has to go is drawing detail nobody can see on screen.

`npm run perf` (`test/perf.mjs`) checks this; **any change touching `app/lib/map/` runs it
and reports the number in the commit message** — "it feels smoother" is not evidence.

Measured numbers, the LOD design and the build-vs-`react-router build` measurement trap
(`npm run build` regenerates `public/data/` and overwrites a hand-built test payload):
see `docs/performance.md`.

## Git conventions

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
- Overrides exist only to close upstream data gaps, each with a `note`; a disputed fact is
  not quizzed — mark it `disputed:` with a reason. Mechanisms: `docs/decisions.md`.
- A new dataset has its licence checked and recorded in README's "Data sources" before it
  is used; anything requiring attribution (GeoNames, CC BY 4.0) is credited in the app, not
  only in the repo. Code is MIT, `content/` + `public/data/` ODbL-1.0 — see `LICENSE`.
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
  remaining lakes without asking first — see "Where this is"'s Next section.
