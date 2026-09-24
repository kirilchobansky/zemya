# Zemya — working instructions

Read this before touching anything. It records decisions already made so they don't get
relitigated each session.

**`docs/` is reference — read the file for the area you're touching (`architecture.md`,
`quizzes.md`, `performance.md`, `decisions.md`, `mobile.md`, `status.md`); this file is the part that always
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

**Working:** the atlas (1:10m canvas map, search, overlays, compare, capitals layer); 197 hand-authored
countries; FSRS study mode; three quizzes on one engine (Countries, Flags, Capitals), now behind a
subject picker (`/quizzes` → Geography today, History a "coming soon" placeholder in the UI); SEO/sharing
metadata; the phone layout (sheet, tabs, touch map, keyboard-aware quizzes, landscape drawer) tested on
a real phone; deployed on Vercel at https://zemya.study, indexed on Google; MIT code / ODbL data. Full
list, with the reasoning behind each item: `docs/status.md`.

**History (data + time-axis engine only, owner-requested, see "Do not" below):**
`content/history/bg.yaml` — 87 hand-authored entries (8 periods incl. the overlapping
Възраждане, 34 `kind: ruler` entries — the 26 First Empire rulers 681–1018 plus the 8 heads of
state since 1989 — 26 `kind: government` cabinets (prime ministers) since 1989, 19 tier-1
dates), validated and built by `scripts/build-history.mjs` (`scripts/lib/history.mjs` has the
date parser and validator) into `public/data/history/bg.json`. **Heads of state are `kind:
ruler`, not `kind: government`** — the ruler wire is one unbroken chain across every era (хан,
цар, княз, президент); `government` is cabinets only, and only exists from 1878 on. TODOs left
in the YAML for Second Empire rulers, monarchs 1878–1946 and communist-era leaders.
`app/lib/history/scale.ts` — decimal-year time representation, viewport projection, the zoom
ladder (millennium…day) and tier-based visibility; pure logic, mirroring `app/lib/map/`'s
projection/camera split, so the eventual canvas renderer and `app/lib/map/` can share a shape
without either importing the other. Placed under `app/lib/` to match `core/`, `map/`,
`geography/` — a prompt asking for `app/history/` gets the `app/lib/` sibling instead; record any
further placement like this the same way. It imports `parseHistoryDate`/`dateKey` straight from
`scripts/lib/history.mjs` (typed via a `.d.mts` sibling, same pattern as `site.mjs`/`site.d.mts`)
rather than duplicating the parser — safe because that module has zero Node dependencies and
Vite bundles it like any other pure module; confirmed by `test/unit/scale.test.ts` importing and
running it through the same Vite pipeline the real app build uses.
`app/lib/history/layout.ts` — built on `scale.ts`: context stack (`contextAt`, what period/
ruler/government contains a moment — gaps are `null`; the ruler and government wires are
independent, so a head of state and a cabinet at the same moment each resolve in their own
slot, not each other's), bar-vs-pinned span classification, per-kind row packing computed from the
whole dataset (so a row never changes while panning), density buckets for the "zoom in, there's
more here" cue, and label-collision resolution. `test/unit/history-mjs-guard.test.ts` asserts
`scripts/lib/history.mjs` imports nothing at all, guarding the assumption `scale.ts`'s import of
it depends on. No UI, no routes, no canvas, no cards read any of this yet — do not start wiring
it up without asking; the exception below is still about the picker, data and these two logic
modules, not a start on rendering.

**Next:**
- Indonesia's capital stays Jakarta until a presidential decree moves it (Nusantara targeted
  2028; re-check before release). The `npm run audit` items are all resolved (Sierra Leone SLE,
  Zimbabwe ZWG, Cuba CUP, Palestine ILS via overrides; the name stays "Cape Verde", "Cabo Verde" is an
  accepted answer).
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
| Hosting | **Vercel**, static only (`vercel.json`; output `build/client`, nothing serverless) | Owner already knows it, and deploy friction is the bigger risk than the bandwidth difference. Originally Cloudflare Pages (free, unmetered bandwidth, preview URL per PR); changed before first deploy, so no migration happened. **Hobby tier forbids commercial use** — if Zemya is ever monetised, hosting must move or be paid for. A real constraint, not a footnote. |
| Backend | **None for now** | Ship without accounts. Local-first from day one so adding sync later costs nothing in perceived speed. |
| Storage | IndexedDB via **Dexie 4.4.6**, local-first | Every interaction must be 0 ms. Never block UI on network. |
| Scheduling | **ts-fsrs 5.4.2** (FSRS), not SM-2, not a 3-in-a-row toy | Modern open algorithm, real intervals and due dates. MIT, open-spaced-repetition org, actively maintained — checked before pinning. |
| Map engine | Custom canvas renderer, **not** Leaflet/MapLibre. Coastlines are **1:10m, unsimplified** (~3.4 MB raw, 687 KB gzipped) | Tiles need a network; a vector-only engine gives true-size re-projection and exact hit-testing for free, and does the pedagogical things a general-purpose library makes harder. Revisit only when city/street detail is actually wanted. Measured before shipping unsimplified: paints in ~585 ms, pans at a solid 60 fps. |
| Repo visibility | Public | Made public so this sandbox can read it. Secrets still never enter the repo. |

## Structure — the layout tree is in `docs/architecture.md` ("Repository layout")

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
- Hosting config is `vercel.json` plus `public/404.html`. Decisions made there: no trailing
  slash (`trailingSlash: false`, `cleanUrls: true`; the build emits `x/index.html` beside
  `x.data`); `/*.data` is served as `text/x-script`, matching what React Router's own server
  sends — a wrong type breaks client navigation silently; everything except `/assets/` must
  revalidate; `framework: null` so Vercel doesn't try to deploy `build/server`; the 404 page
  is a hand-written static file with its tokens inlined (no route renders for unknown URLs
  on a static host). Unhashed data caching: `docs/performance.md`.
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
| A new quiz question (answer, skip or reveal alike) | returns the view if zoomed in, then moves ONLY if the target isn't comfortably visible and legible — one path, `Atlas#followTarget`; see `docs/quizzes.md` |
| Wheel, drag, pinch, double-click | unchanged |

Intent travels as React Router location state: `state={{ fly: true }}` on a `Link`,
`{ state: { fly: true } }` on `navigate()`. The map's own click handler passes nothing.
`flyTo` and `home` on the Atlas controller are unchanged by this rule — it governs who
calls them, not what they do.

## Places, cards and quizzes — the rules; the reference is in docs/

- **Places / capitals** (`docs/architecture.md`): do not add non-capital cities without a
  decision. Rings, labels and hit-testing all go through the one `capitalsVisible()`
  predicate, which `quizMode` turns off. Capital aliases are exact after `normaliseName`;
  a collision throws at build time, and so does an alias equal to the country's own name or aliases (the capital being the name — Monaco — is the only exception; San Marino's capital is overridden to "San Marino" so it fits that exception).
- **Cards** (`docs/architecture.md`): one card per (country, facet), id `geo:BGR:capital`,
  lazy, mastery derived never stored, writes never awaited by the UI. **Every table the app
  writes must be covered by reset, export and import** — all three, same commit.
- **Quizzes** (`docs/quizzes.md`): one engine, one route, behind a subject picker
  (`/quizzes` → `/quizzes/:subject` → `/quizzes/:subject/:quizId/:scope/:size`); a new quiz
  is a `QuizDefinition` plus its id in `react-router.config.ts`'s `QUIZ_IDS`, still under
  the geography subject in `app/lib/quiz/subjects.ts`. Anything that could show a country's
  name is gated on the single `quiz`/`quizMode` value. No Stage may move when its content
  changes size. Never `disabled` the run input.

## Mobile — the rules; the reference is `docs/mobile.md` (read it before touching the phone layout)

- **LAYOUT follows viewport width** (phone layout below 820px, or a coarse pointer under 500px
  tall — `app/lib/viewport.ts`, mirrored in `app.css`); **INPUT AFFORDANCES follow the pointer**
  (`(pointer: coarse)`). Never gate markup on a JS media query (it would mismatch the prerendered
  HTML); phone furniture is in the DOM everywhere and `display: none` above the breakpoint.
- One `100dvh` shell (never `vh`); the body never scrolls. Bottom-pinned things pad with
  `env(safe-area-inset-bottom)`. The panel is a bottom sheet (peek/half/full, `transform` only) — a
  right-hand drawer in landscape.
- Anything `position: fixed` that a panel route renders is **portalled to `<body>`** (a transformed
  sheet traps fixed children).
- Quiz runs on a phone: START focuses the input **synchronously inside the tap**; the input keeps
  its attributes (`autocorrect=off autocapitalize=none spellcheck=false …`) and is never blurred
  during a run; the canvas never takes focus there; keyboard position from `visualViewport`; no key
  hints or shortcuts on coarse pointers (`.only-fine` / `.only-coarse`).
- The camera frames in the *visible* area (`Insets`); a render is requested, never issued from an
  event handler, and gestures draw a snapshot bitmap; routes have `clientLoader`s that answer from
  memory. Playwright cannot emulate an on-screen keyboard.

## Commands

```bash
npm install
npm run dev             # dev server on :5173
npm run build           # build:content, then prerender 286 static pages
npm run build:content   # content/ -> public/data/geography/
npm run typecheck       # react-router typegen && tsc --noEmit
npm test                # serves build/client and drives a real browser
npm run test:unit       # vitest — pure-logic tests (scheduler, mastery), no browser
npm run check:seo       # audits build/client: sitemap, unique titles, one absolute canonical, JSON-LD parses
npm run audit           # stale-data report: shipped fields vs a second dataset + a watchlist. Read-only. RUN BEFORE ANY RELEASE
npm run audit:flags     # rasterises every flag, checks it against its authored description (needs Chromium)
npm run perf            # serves build/client, drives a real browser, reports frame time
```

`npm test` requires a completed `npm run build`. In this sandbox pass
`CHROMIUM_PATH=/opt/pw-browsers/chromium`.

Prerendered pages and what `test:unit` covers: `docs/architecture.md`.

## Performance

**Target: 16.7 ms median frame time (60 fps) at world zoom, full pan/zoom, with full 1:10m
coastline detail preserved when zoomed in.** Detail is not the thing to sacrifice — it's
visible and was asked for. What has to go is drawing detail nobody can see on screen.

`npm run perf` (`test/perf.mjs`) measures this, but it is **not** a required step: run it only
when a prompt explicitly asks. Same for `npm test` and screenshots.

Measured numbers, the LOD design and the build-vs-`react-router build` measurement trap
(`npm run build` regenerates `public/data/` and overwrites a hand-built test payload):
see `docs/performance.md`.

## Git conventions

Solo project, one machine, one person. No branches, no pull requests, no CI.

- Work directly on `main`. Do not create branches. Do not open pull requests.
- Commit when a change works. Small commits are fine; perfect commits are not required.
- Commit subject: imperative, lower case, no trailing period. One line is enough.
- **Default verification:** `npm run typecheck`, `npm run test:unit`, `npx react-router build`.
  Browser tests (`npm test`), screenshots and `npm run perf` run ONLY when a prompt explicitly
  asks — no mandatory browser step. Run `npm run build:content` too when content changed, and
  commit the regenerated public/data in the same commit. Keep reports short.
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
- Flag images come from svg-country-flags, which mirrors Wikimedia and lags it. When one is
  stale, drop the corrected file in `content/flags/<iso2>.svg` with `<iso2>.note.md` saying
  why (`docs/decisions.md`). The build throws on an SVG with no note, a note with no SVG, or
  an ISO2 that isn't shipped, and prints `flag overrides N (XX)` so a fixed-upstream override
  gets noticed and deleted. Same rule as data overrides: closes gaps, never expresses an opinion.
- Upstream data goes stale (Bulgaria's euro, Sierra Leone's leone). `npm run audit`
  (`scripts/audit-freshness.mjs`) compares currency, capital and name against countries-list, a
  second independent dataset, and checks a hand-kept watchlist of recent changes. It changes
  nothing; a human decides each case and fixes it with an `override:` + note. Extend the
  watchlist when the world changes something. Population is excluded on purpose.
- `content/geography/confusable-flags.yaml` is the one content file that isn't
  per-country — a hand-curated list of flag pairs the "Name the Flag" quiz accepts for
  each other (see Quizzes). Same rule as everywhere else in `content/`: plain YAML,
  editable without touching code, and a mandatory `note` saying why the pair is genuinely
  confusable, not asserted opinion.

## Do not

- Do not add subjects beyond geography until geography ships and has users. The multi-subject
  vision shapes the *architecture*, not the roadmap. **Exceptions, deliberately drawn narrow:**
  (1) the quiz picker (`/quizzes`) lists History as a second subject with an empty quiz list and
  a "coming soon" state (`app/lib/quiz/subjects.ts`) — owner-requested UI scaffolding for the
  subject layer itself. (2) `content/history/bg.yaml` — owner-requested history *data*, built by
  `scripts/build-history.mjs` into `public/data/history/bg.json`. (3) `app/lib/history/scale.ts`
  and `app/lib/history/layout.ts` — owner-requested time-axis and layout *logic* (decimal years,
  viewport projection, zoom ladder, tier visibility, context stack, row packing, label collision;
  no canvas, no React, no DOM). See "Where this is" for all of these. None of these
  extends past what it names: no history routes, cards, quiz content, canvas renderer or other UI
  reads any of this yet, and no further history countries, content kinds or logic modules without
  asking again.
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
