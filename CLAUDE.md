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
- Capitals as a map layer (ring + name together from 9x, later for small countries by area, off in quizzes) — `docs/architecture.md`.
- FSRS card per (country, facet), mastery derived, Dexie/IndexedDB, export/import/reset;
  study mode with 9 question kinds and `disputed:` facets.
- Three quizzes on one shared engine (Countries, Flags, Capitals): continent scopes, a
  computed size ladder, personal bests and run history, still layouts (`docs/quizzes.md`).
  One camera path for every new question (skip = answer): centres a target that isn't
  comfortably inside, zooms in until it is legible (12 px wide; micro-states go far),
  continent as home. Brass = question, red = revealed, green = correct. A capital ring never
  shows before its country's outline (thresholds are derived in `app/lib/map/thresholds.ts`).
- A capital alias may not be the country's own name (build throws; Monaco-style capital == name
  is the exception). `npm run audit` (stale data) and `npm run audit:flags` (flag vs description)
  exist; Bulgaria ships EUR; Syria's flag is a `content/flags/` override.

- Search and sharing metadata on every page: canonical, Open Graph, Twitter card, per-(quiz, scope,
  size) quiz titles, JSON-LD (`Country` per dossier, `WebSite` on `/`), generated `robots.txt` +
  `sitemap.xml`. The origin is `SITE_URL` (`.env.example`; one edit, or a Vercel env var) — the
  committed default `https://zemya.example` is a placeholder until the domain is attached.
  `npm run check:seo` audits `build/client` (run after `npm run build`). `docs/decisions.md`.
- Phone layout (below 820px wide): full-screen map, the right-hand panel as a bottom sheet with
  three snap points, a bottom tab bar, a Layers button, touch pan/pinch, and quiz runs built
  around the on-screen keyboard. Desktop unchanged. The keyboard behaviour is verified only in
  emulation — **still to be tried on a real phone** (Vercel preview). See "## Mobile".
- Deployment-ready as static files on Vercel (`vercel.json`, `public/404.html`); not yet deployed.
- Licensed (MIT code, ODbL data); sources in README, GeoNames credited in the rail footer.

**Next:**
- `npm run audit` reports, not yet fixed (owner to approve each): Sierra Leone still `SLL`
  (SLE since 2022), Zimbabwe ships Botswana pula (ZWG), Cuba `CUC` (abolished 2021), Palestine
  `EGP` (a wrong currency; ILS is the usual), and the name "Cape Verde" vs the official Cabo Verde
  (bare "Cabo Verde" is already an accepted answer). Indonesia's capital stays Jakarta until a
  presidential decree moves it (Nusantara targeted 2028; re-check before release).
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

## Structure

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
- **Quizzes** (`docs/quizzes.md`): one engine, one route; a new quiz is a `QuizDefinition`
  plus its id in `react-router.config.ts`'s `QUIZ_IDS`. Anything that could show a
  country's name is gated on the single `quiz`/`quizMode` value. No Stage may move when its
  content changes size. Never `disabled` the run input.

## Mobile

Two switches, deliberately independent:

- **LAYOUT follows viewport WIDTH.** `max-width: 819px` (`PHONE_MAX_WIDTH` in
  `app/lib/viewport.ts`, mirrored in `app.css` — change both) is the phone layout. An iPad in
  landscape is the desktop layout. Between 820 and 1000px the rail/panel columns are tighter.
- **INPUT AFFORDANCES follow the POINTER.** `@media (pointer: coarse)` / `isCoarsePointer()`:
  44px touch targets, no hover tooltip, no +/- zoom buttons (pinch exists), no `<kbd>` hints,
  16px input text (iOS zooms the page under that). `.only-fine` / `.only-coarse` swap copy
  ("Click" / "Tap") in CSS, so prerendered HTML never differs by device.

The phone furniture (tab bar, sheet handle, peek content, Layers button, overlay sheets) is in
the DOM at every width and `display: none` above the breakpoint. Do not gate markup on a JS media
query — it would mismatch the prerendered HTML. JS is for behaviour only (`useSheetDrag`, camera
insets), always read at event/effect time.

**The shell.** One viewport tall, `100dvh` (never `vh`); the body never scrolls, only sheet
content (`overscroll-behavior: contain`). The canvas fills the screen behind everything.
Every bottom-pinned thing pads with `env(safe-area-inset-bottom)` (`--tabbar-h` carries it).

**The sheet** is the ordinary `.panel` (`<aside>` in `routes/atlas.tsx`), restyled: 90dvh tall,
parked with `transform: translateY(...)` — snapping animates transform only, never height.
Snaps (`app/lib/sheet.ts`, mirrored in CSS `.panel[data-snap]`), measured from the viewport
bottom: **peek** = tab bar + 88px (handle + the route's `.peek` line), **half** 50%, **full**
90%. The header/handle drag the sheet; inside the scrolling body a drag moves the sheet only when
the body is scrolled to the top (down always, up only below full), otherwise it scrolls. Tap the
handle/arrow to step peek -> half -> full -> half. Snap state lives in `AtlasShell`; a route
asks for one with `state={{ sheet: 'peek' | 'half' }}` (map tap and search pick: peek; tabs:
half). A link that says nothing (a neighbour chip in the sheet) leaves it where it is. **Decision:**
a cold load of anything but `/` opens at half (the page is why they came).
Each panel route's `<header className="panel__head panel__head--peek">` holds a `.peek` block —
what shows at the lowest snap (country: flag + name + capital · population · currency; home:
"Explore the map" + a search prompt; catalogue: "Quizzes"). Routes without one show their
ordinary eyebrow + h2.

**Tab bar:** Map · Quizzes · Study · Progress. Progress is not a route: it opens the Progress
overlay sheet (`ProgressSheet`, the same `ProgressSection` + `DataSection` the desktop rail
uses, so Export/Import/Reset stay one implementation). The Layers button (top right) opens
`LayersSheet` (overlay chips + legend from `LayerControls`, the three toggles, Compare size) —
it replaces the desktop toolbar, which is `display: none` on phones. ⌂ is a small floating button
under it; the scale bar is hidden on phones. Icons are inline SVG (glyph characters fall back to
tofu on some fonts).

**Touch map** (`app/lib/map/atlas.ts`): `touch-action: none` on the canvas; one finger pans, two
fingers pinch about their midpoint (the world point that started under the fingers stays under
them, so a two-finger drag also pans). No hover for `pointerType === 'touch'` (no tooltip, no
hover highlight); a tap selects. Hit areas on touch are 24 px radius for capital rings and
micro-state pins (`TOUCH_HIT_RADIUS_PX`) — drawing unchanged. The canvas DPR cap of 2 in
`Atlas#resize` already applies at every width. Phone perf at 4x CPU throttle **misses** the
target in this sandbox — numbers and cause in `docs/performance.md`.

**Visible map area** (`Insets` in `camera.ts`): whatever covers the canvas is subtracted from
the viewport everywhere the camera frames something — `Atlas#setInsets`, then `frame`,
`homeCamera`, `flyTo`, `fit`, `home` and the clamp all respect it (`Viewport.insets`), and
`followTarget` takes the same insets. On phones the shell sets `{ top: below the search pill,
bottom: what the sheet covers at its snap }`; a full sheet is treated as half (nobody frames a
country in a 10% strip). Desktop has none — the panel is a grid column, not an overlay.

**`position: fixed` inside the sheet is a trap:** a transformed ancestor becomes the containing
block, so anything fixed that a panel route renders (the quiz dock, the flag stage) is
**portalled to `<body>`** (`createPortal` in `MapStage` / `FlagsStage`). Do the same for anything
new.

**Quiz runs on a phone** (`setImmersive` in the atlas context): on a valid run the shell hides the
sheet, tab bar and overlays from START to the results; results open the sheet at `full`
(`setSheetSnap`). The layout is built around the on-screen keyboard, which covers ~40% of the
screen: a thin HUD on top (timer · n / N · pause; `‹ Quizzes` before START), the map (or the
flag) in the middle, the input bar at the bottom pinned directly ABOVE the keyboard
(`.quiz-controls`, `bottom: var(--kb)`). Pause opens a screen with Resume and Abandon. The rules:

- **Keyboard position** comes from `visualViewport` (`app/lib/keyboard.ts`: resize + scroll) and is
  published as `--kb` / `--vv-top` / `--layout-h` / `--kb-est` on `<html>`. The viewport meta also
  says `interactive-widget=resizes-content` (Chrome on Android resizes the layout viewport
  itself) but nothing may rely on it: iOS Safari ignores it, and `visualViewport` is what works.
- **The camera's visible area during a run is the strip between the HUD and the input bar**,
  measured from the DOM (`measureInsets` in `quiz.$quizId.tsx`) and recomputed — with the
  current target followed again, no pulse — whenever the keyboard opens or closes.
- **START focuses the input SYNCHRONOUSLY inside its tap handler** (`startRun`; also "Run it
  again"). iOS opens the keyboard only for focus inside the gesture; an effect or timeout leaves
  it closed. That is why the input is mounted in every phase — `QuizControls` renders it hidden
  (`--idle`, a 1px opacity-0 container) in idle and done — and why `test/smoke.mjs` checks the
  *call stack* of the first `focus()`, not just `activeElement` (Chromium focuses from the effect
  too, so "is it focused" proves nothing).
- **The input's attributes** stop iOS "correcting" answers ("Chad" -> "Chat"): `autocomplete=off
  autocorrect=off autocapitalize=none spellcheck=false inputmode=text enterkeyhint=done`; Enter is
  swallowed (the done key would dismiss the keyboard). The font is 16px (iOS zooms under that).
- **The keyboard stays open for the whole run.** The input is never blurred between questions; the
  canvas never takes focus (`Atlas#setKeepFocus` cancels pointerdown, mousedown and touchstart on
  it — only on a phone layout or coarse pointer; on desktop a canvas click still blurs and the
  typing capture in `engine.ts` recovers, which `test/smoke.mjs` relies on); the Skip / Reveal /
  Pause / Resume / Abandon buttons cancel pointerdown so a tap on them doesn't move focus either.
  The results screen blurs it (the keyboard would cover them).
- **Shortcuts don't exist on a phone**, so real buttons do: Skip and Reveal beside the input
  (48px), Pause in the HUD, Abandon in the pause screen. The Stages take `skip/reveal/canSkip/
  canReveal` for this. On desktop the buttons are `display: none` and `.quiz-controls` /
  `.quiz-dock__row` are `display: contents`, so the desktop layout is untouched.
- **Copy by pointer:** "Tap START" on coarse pointers, "Press START — or Space, or Enter" on fine
  (`.only-coarse` / `.only-fine`); `<kbd>` hints are hidden on coarse pointers. Any new hint that
  names a key needs the same split.
- **Flag quiz:** the flag box is sized ONCE from the strip left with the keyboard OPEN
  (`--layout-h` minus `--kb-est`, the HUD and the bar) and top-anchored, so it never jumps when
  the keyboard opens and never hides behind it; `--kb-est` only grows.

**What Playwright cannot verify:** it emulates the viewport and touch, but not an on-screen keyboard
— it cannot open one or shrink the visual viewport. The keyboard behaviour (the bar riding on it,
the flag fitting above it, the camera re-following, iOS opening the keyboard from START) needs a real
phone; the smoke test covers everything that doesn't need one.

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
