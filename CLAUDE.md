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
| Storage | IndexedDB (Dexie), local-first | Every interaction must be 0 ms. Never block UI on network. |
| Scheduling | FSRS, not SM-2, not the prototype's 3-in-a-row toy | Modern open algorithm, real intervals and due dates. |
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
app/lib/map/            projection, topology, camera, renderer, controller. no React.
app/lib/geography/      overlays, client payload loader, *.server.ts catalog readers
app/lib/format.ts       shared formatting and normalisation
app/components/         Rail, SearchBox, and future panels
app/routes/             atlas.tsx (layout, owns the canvas) + panel routes
app/styles/             tokens.css then app.css
public/data/geography/  generated, committed on purpose
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

Rules that follow from this layout:

- `content/` must stay editable by a non-programmer. Plain YAML/text, no code, no build
  step required to read it. It may move to its own repo later — don't couple it to `src/`.
- Generated data is **committed**, not built at deploy time. A content edit shows up as a
  diff in both `content/` and `public/data/`.
- `app/lib/map/` must not import React or anything from `app/lib/geography/`. It is a
  standalone renderer; the globe projection and the history timeline will both reuse it.
- Anything reading `public/data/*.json` from disk lives in a `*.server.ts` file, so the
  bundler strips it from the client. A 153 KB catalogue must never ship to a browser
  twice.
- Route loaders run at **build time** — every page is prerendered. Node APIs are fine in
  them; `window` is not.

## Commands

```bash
npm install
npm run dev             # dev server on :5173
npm run build           # build:content, then prerender 197 static pages
npm run build:content   # content/ -> public/data/geography/
npm run typecheck       # react-router typegen && tsc --noEmit
npm test                # serves build/client and drives a real browser
```

`npm test` requires a completed `npm run build`. In this sandbox pass
`CHROMIUM_PATH=/opt/pw-browsers/chromium`.

(In `prototype/`: `npm install && npm run build`.)

## Git conventions

- **Never commit to `main`.** Branch, push, hand over a compare link. The owner merges.
- Branch names: `feat/…`, `fix/…`, `chore/…`, `docs/…`
- Commit subject: imperative, lower case, no trailing period. Body explains *why*.
- One logical change per PR. If a PR needs three paragraphs to explain, it's two PRs.
- Branch protection is convention here, not enforcement. Treat it as enforcement anyway.
- This sandbox can **read** the repo but not push to it. Work is handed over as a git
  bundle for the owner to push.

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
