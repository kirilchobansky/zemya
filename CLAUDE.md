# Zemya — working instructions

Read this before touching anything. It records decisions already made so they don't get
relitigated each session.

## What this is

An interactive atlas for learning geography (later: history), built around one idea —
every subject has a natural spatial index, and you learn by navigating it. Geography's
index is the map; history's is the timeline. They share one data model. Events happen in
places.

Owner: Kiril (@kirilchobansky). Solo project. Bulgarian; "Zemya" = Земя, earth.

## Locked decisions — do not reopen without asking

| Decision | Choice | Why |
| --- | --- | --- |
| Platform | Web, PWA-installable | Install friction kills education tools. Deep links are the only free acquisition channel. |
| Framework | React 19 + Vite 8 + TypeScript + React Router **v8** (framework mode) | Owner already knows React. The perf-critical part is canvas, which is framework-agnostic. Framework mode pre-renders, so `/country/bulgaria` is a crawlable document. (v8, not the v7 first discussed — v8 is current and the config is the same shape.) |
| Hosting | Cloudflare Pages, fully static | No server needed. Free. Preview URL per PR. |
| Backend | **None for now** | Ship without accounts. Local-first from day one so adding sync later costs nothing in perceived speed. |
| Storage | IndexedDB via **Dexie 4.4.6**, local-first | Every interaction must be 0 ms. Never block UI on network. |
| Scheduling | **ts-fsrs 5.4.2** (FSRS), not SM-2, not the prototype's 3-in-a-row toy | Modern open algorithm, real intervals and due dates. MIT, open-spaced-repetition org, actively maintained — checked before pinning. |
| Map engine | Custom canvas renderer, **not** Leaflet/MapLibre | Tiles need a network; a vector-only engine gives true-size re-projection and exact hit-testing for free, and does the pedagogical things a general-purpose library makes harder. Revisit only when city/street detail is actually wanted. |
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
  bundler strips it from the client. A 153 KB catalogue must never ship to a browser
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
absence of a row, not a row in a new state. 196 countries never means 1,568 rows up front.

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

## Commands

```bash
npm install
npm run dev             # dev server on :5173
npm run build           # build:content, then prerender 197 static pages
npm run build:content   # content/ -> public/data/geography/
npm run typecheck       # react-router typegen && tsc --noEmit
npm test                # serves build/client and drives a real browser
npm run test:unit       # vitest — pure-logic tests (scheduler, mastery), no browser
```

`npm test` requires a completed `npm run build`. In this sandbox pass
`CHROMIUM_PATH=/opt/pw-browsers/chromium`.

`npm run test:unit` needs no build — it exercises `app/lib/core/` and
`app/lib/geography/mastery.ts` directly, importing real content through the same
`catalog.server.ts` reader every route loader uses.

(In `prototype/`: `npm install && npm run build`.)

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
