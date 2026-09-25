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
a real phone; System/Light/Dark theming (`app/lib/theme.ts`, tokens.css's `[data-theme]` blocks,
`ThemeControls` in the rail and the Layers sheet), WCAG AA-checked in both themes; deployed on Vercel
at https://zemya.study, indexed on Google; MIT code / ODbL data. Full list, with the reasoning behind
each item: `docs/status.md`.

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
it depends on.

**First render, owner-requested:** `/history/bulgaria` — canvas only, no dossier, no hover, no
selection, no quiz; not linked from anywhere, noindex, prerendered but left out of `indexable`
(the sitemap list) in `react-router.config.ts`. `app/lib/history/renderer.ts` (the cylinder band,
tick marks via `ticks()` — with `placeLabels()` resolving label crowding at borderline zooms, a
real defect caught by an actual render, not by typecheck — the screen-fixed centre marker, and
period/ruler bars via `assignRows()`/`classifySpan()`) and `app/lib/history/timeline.ts` (the
`HistoryTimeline` controller: render-request queue, DPR/resize, drag-to-pan, wheel/pinch-to-zoom).
Every draw function takes `axis: 'horizontal' | 'vertical'` and goes through one `project()`
helper — only horizontal is wired up. `Atlas` (`app/lib/map/atlas.ts`) could not be reused
directly (typed throughout against the 2D geography camera/World/Feature); `HistoryTimeline`
copies its *pattern* — render-request queue, `ResizeObserver`-driven resize, "hold the point under
the cursor/pinch fixed" — one dimension smaller, against `scale.ts`'s `Viewport` instead of
`camera.ts`'s `CameraState`. `app/lib/history/catalog.server.ts` reads `public/data/history/bg.json`
and converts each entry's date string to a decimal year server-side (`scale.ts`'s `decimalYearOf`,
safe to run there — pure logic, not Node-specific), mirroring `app/lib/geography/catalog.server.ts`.
No dossier, no hover, no selection, no quiz, no card, and no link to it from anywhere else in the
app yet — do not extend past this route without asking; the exception below now covers exactly
these five files plus this one page, not a start on the real timeline UI.

**Legibility pass, owner-requested (same five files, still no dossier/hover/selection/quiz):**
Bar/pin labels are `name.bg`, not English — this is a Bulgarian timeline, and both canvas fonts
(`--font-ui`/`--font-mono`, i.e. Archivo/IBM Plex Mono) carry Cyrillic; `HistoryTimeline` also
awaits `document.fonts.ready` once and re-renders, so a frame drawn before the webfont loads gets
corrected instead of staying stuck on a Latin-only fallback. Bar labels truncate-with-ellipsis to
their own bar's width (hidden entirely, bar still drawn, when there's no room even for the
ellipsis); every label — ticks, bars, pins, context-stack lines — is now collision-resolved by
`placeLabels()`, grouped by whatever actually shares a line (a lane row; the tick strip) rather
than by the whole page, since two labels in different rows never visually compete. `contextAt`
(`layout.ts`) is now generic (`ContextSlot<T>`/`Context<T>`) so its `.primary` carries a
`TimelineEntry`'s `.label` straight through — a non-breaking signature change, re-verified against
`layout.test.ts`'s existing 38 cases. Events (`kind: event`) draw as pins below the cylinder: stem,
dot, "year — name.bg", culled and tiered the same as everything else. The context stack — period,
ruler, government, largest at the top, above the cylinder, centred under the centre marker, a gap
rendered as nothing — reads `contextAt()` against the centre date on the WHOLE dataset, never the
zoom-culled subset, so it's correct at every zoom, not just the ones with bars on screen. Initial
view fits the whole dataset (earliest authored `start` to today's actual wall-clock year — `Date`
used only for that, never for parsing an authored date) with a small margin, computed once on the
first real resize; a later resize (an actual window resize) never re-fits and so never discards
the visitor's own pan/zoom.

Two real defects, found only by an actual browser render (not by typecheck/test:unit/build) and
fixed in the same pass — both are why this route's own checklist asks for a browser look, not just
the usual three commands: (1) `classifySpan`'s pinned `labelPx` and an event's raw time position
are clamped to keep one ANCHOR point on screen; centred text at an anchor pinned right at the edge
still had half of itself rendered off-canvas, so the renderer now clamps a second time
(`clampCentredAnchor`) using the actual measured text width before positioning or feeding
`placeLabels`. (2) Two non-overlapping periods sharing an `assignRows` row (Byzantine rule, then
Second Empire) could both be "pinned" near their shared boundary with clamped anchors close enough
to collide even though their real date ranges never touch; a plain tier/id tie-break could then
hide whichever period the view is actually mostly inside of behind whichever the view barely
touches at the edge. Fixed by nudging a PINNED candidate's tier (render-time only, never the
entry's real editorial tier) by how much of the visible range its own span covers, so "what's
mostly on screen" wins the tie. Also: an event with no authored `end` was defaulting to
`Infinity` (scale.ts's correct "ongoing" rule for a period/ruler/government's open end) rather
than `start` (the correct rule for a single-moment event), so an undated-end event from any point
in the past kept counting as "visible" — and its pin kept drawing — in every later view; fixed
where the kind-specific meaning belongs, in `catalog.server.ts`'s raw-to-`TimelineEntry`
conversion, not by teaching the generic, kind-agnostic `scale.ts`/`layout.ts` a kind-specific
exception.

**Full-cylinder redesign, owner-requested (same five files, still no dossier/hover/selection/quiz;
supersedes the two passes above — their specifics below are no longer current):** The cylinder IS
the page now: full canvas width edge to edge, vertically centred, its own height animated between
`CONFIG.minCylinderThicknessFrac` (12%) and `maxCylinderThicknessFrac` (85%) of `crossSizePx` as a
function of zoom (`cylinderThicknessFraction`, `scale.ts` — log-scale interpolation, since zoom is
multiplicative, smoothstep-eased). `HistoryTimeline` never snaps to that target: `renderNow()` calls
`updateCylinderAnimation()` every frame, exponentially easing `cylinderFrac` toward it
(`CYLINDER_EASE_MS` = 160ms time constant) and re-requesting a frame while still short of it, so a
single discrete wheel notch still animates the cylinder's size over several frames rather than
jumping once. `RenderContext` carries the resolved `cylinderThicknessPx` and `contentRange` down to
the renderer, which treats both as plain snapshots — it has no idea an animation is happening.

Everything except the centre date readout now lives INSIDE the cylinder. Year ticks moved onto its
own top surface (`drawTopTicks`, `RENDER_CONFIG.tickStripHeight`) — the tick-thinning logic itself
(`niceStep()`/`CONFIG.tickTargetCount`, `scale.ts`) is unchanged by this pass, only where the marks
draw. Below the tick strip, up to four horizontal "wires" stack in duration order — period, ruler,
government, event (`WIRE_ORDER`) — each entry a rounded capsule (`ctx.roundRect`) filled with a
cross-axis gradient in that kind's colour (dim at the edges, bright through the middle, the same
technique as the cylinder's own gradient) with its Bulgarian name inside, truncated to the capsule's
own width. **Governments now have a real visual — capsules on their own wire — for the first time**;
the previous two passes only ever summarised them as floating text, never drew them at all.

A wire "unlocks" as the cylinder grows, smoothly (`wireRevealAt`, thresholds along the cylinder's
own normalised 0–1 growth: ruler at 0.22, government at 0.46, event at 0.68, each with a 0.12-wide
eased fade-in band) — tied to the cylinder's OWN eased size rather than raw pxPerYear, so a wire's
appearance inherits the same never-a-snap animation for free. A wire with nothing currently visible
gets no row at all, so unclaimed space merges into its neighbours rather than sitting reserved and
blank; within a wire, capsule height and font size both scale with how much room is actually
available right now (`layoutWires`/`drawWireCapsules`) — "fill the space instead of leaving it
empty." Periods additionally paint a wide translucent band behind everything inside the cylinder,
coloured by the period's stable position in the WHOLE dataset (`periodIndexOf`, computed once from
every period so a given era's wash never changes colour as it scrolls in and out of view) cycling
through a small fixed palette (`PERIOD_BAND_COLORS`) — a judgement call, since the brief didn't
specify per-era colours, made because a single uniform wash across periods that mostly tile the
whole range contiguously wouldn't read as distinct eras at all.

*"The wire containing the centre date is drawn larger and brighter than the others — the current
focus"* is implemented per-CAPSULE, not per-row: for period/ruler/government, `contextAt` (reused
from the earlier passes) finds the one entry whose span contains the centre date, and that specific
capsule draws at `capsuleFocusScale` (1.28×) with a brighter fill/stroke/text — not the whole wire,
since nearly every wire always has SOME entry at the centre (a period covers the whole range almost
contiguously), so highlighting an entire row would rarely distinguish anything. Events have no
"current" concept (a zero-duration moment either is or isn't the centre, never "the one containing
it" among several) and are never focus-highlighted.

Pan is now clamped to the data's own range padded by HALF A VIEWPORT on each side — specifically
half of whatever the viewport shows at maximum zoom-out, i.e. half of `contentRange`'s own span
(`HistoryTimeline.computeRanges`) — so 681 and today can each be brought all the way to the centre
marker. This needed the zoom-out FLOOR and the pan-CENTER bound to read from two different ranges,
not one: `clampPxPerYear` is called with `contentRange` (so minimum zoom is exactly "the cylinder
fills the viewport with the whole content span, no padding"), while `clampCenter` is called with the
wider, half-viewport-padded `pannableRange` — both existing `scale.ts` functions, unchanged; only
which range `timeline.ts` hands each one changed. `FIT_MARGIN` and the old 4%-of-span
`RANGE_MARGIN_FRACTION` are both gone: the default/initial view is now exactly that same zoom-out
floor (content fills the cylinder's width edge to edge, no screen-space padding), matching "the
cylinder fills the screen" thematically. Beyond `contentRange` — reachable now that panning extends
that far — the cylinder's brightness fades towards the outer regions (`drawOutOfRangeFade`, a dark
gradient overlay) with a muted centred label once enough of that empty zone is on screen: "Преди
`<earliest year>` — Стара Велика България" on the left (`earliest year` read off `contentRange.from`,
not hand-typed, so it can't go stale if the dataset's own start ever moves) and "Бъдеще" on the
right.

The old floating context-stack text and the old full-height centre line are both gone — "nothing
outside the cylinder except the centre date readout" is now literal: the only thing drawn outside
`[cylinderTop, cylinderBottom]` is `drawCentreDate`. A faint centre line still exists for legibility
(so it's clear which capsule the readout refers to when several sit close together) but is now
clipped to the cylinder's own inner height, which satisfies the brief without losing that cue.

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

**No longer a single committed dark theme — the owner asked for light mode.** Three states:
System (follows the OS, the default) / Light / Dark, switched from the Layers sheet on
phones and the rail on desktop (`ThemeControls`, `app/components/Rail.tsx`), persisted in
`localStorage` (`app/lib/theme.ts`) and applied before first paint by an inline script in
`root.tsx` — the documented exception to "do not use `localStorage`" below: it is a
per-browser display preference, not progress data, and must be read synchronously or the
page flashes the wrong theme. **Any colour change from here on must be checked in BOTH
themes.** Still a chart room in both, not a generic dashboard or a white void: light is
paper-and-ink (off-white page, white land, light blue-grey sea, darker borders, deepened/
desaturated accents), not the dark palette's colours inverted. Do not drift toward the
default "near-black + one neon accent" look, in either theme.

Tokens live in `app/styles/tokens.css` and are the single source of truth, dark values in
`:root`, light overrides under `[data-theme="light"]` (and mirrored under a bare
`prefers-color-scheme: light` for System). **The canvas cannot read a CSS variable once per
frame** — `app/lib/map/renderer.ts`'s `COLORS` and `app/lib/geography/overlays.ts`'s
exported palette are resolved from these tokens with `getComputedStyle` exactly once
(`refreshMapColours()` / `refreshOverlayColours()`), cached, and re-read only on a theme
change (wired up in `app/routes/atlas.tsx`) — never inside `render()`. This replaces the
former exception where `--land` and the micro-state pin were hardcoded literals in
`renderer.ts`; nothing needs hand-mirroring into a `.ts` file anymore, only the resolved
colour cache needs a fallback default (kept equal to the token by hand, same convention both
files now use for every entry, not just those two).

```
--abyss       #080D13 / #F4F1EA   ground, deep sea ink / off-white page
--chart       #0E1720 / #FFFFFF   panel surface
--chart-2     #14212C / #ECE7DD   raised surface
--rule        #243543 / #C9BEAC   hairline
--ink         #E6EEF3 / #201A12   primary text
--ink-2       #9FB3C0 / #5A5040   secondary text
--ink-3       #748D99 / #6D6252   tertiary / labels — AA-checked, not a straight deepen of --ink-2
--brass       #E8A33D / #A8641C   accent, borders, TEXT — deepened for its own contrast on a pale surface
--brass-fill  #E8A33D / #B3741E   a brass-FILLED control's background (chip, primary button) —
                                   diverges from --brass in light: that button's --ink-on-brass
                                   text needs the fill to stay light, the opposite direction from
                                   --brass-as-text's own contrast need. See tokens.css's comment.
--sea         #4EA9C9 / #1F7691   secondary accent, selection-adjacent
--new         #E2544F / #B23A35   mastery: new
--learn       #E8A33D / #A8641C   mastery: learning
--master      #3DD68C / #16875A   mastery: mastered
--land        #31485A / #FFFFFF   default landmass fill
--ocean       #080D13 / #CFE0E6   canvas water — equals --abyss in dark on purpose, diverges in light
```

(dark / light — see `tokens.css` for the full palette, including `--brass-2`/`--brass-fill-hover`,
the choropleth overlays' categorical hues, and every `-rgb` companion token used for JS/CSS alpha
blending.)

**Contrast, checked against WCAG AA (4.5:1 normal text) in both themes** — computed from the
tokens above, not eyeballed: `--ink`/`--ink-2` on `--chart`/`--chart-2`/`--abyss` all clear
7:1+ in both themes. `--ink-3` was the one failure as first drafted (4.2–4.4:1, both themes)
and is the value now in the table. `--brass`/`--brass-2` as text clear 4.5:1+ on `--chart` in
both themes. The one fill/text pair that cannot be solved with a single token —
`--ink-on-brass` on a brass-filled control — is `--brass-fill`/`--brass-fill-hover`, above.
The three quiz state colours (question = `--brass`/`--brass-fill`, revealed = `--new`, correct
= `--master`) keep the dark theme's own hue separation (~30° apart for question/revealed, over
100° to correct) in light too — unchanged by this pass, not re-litigated.

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
  no canvas, no React, no DOM). (4) `/history/bulgaria` — owner-requested first canvas render
  (`app/lib/history/renderer.ts`, `timeline.ts`, `catalog.server.ts`); unlinked, noindex, no
  dossier/hover/selection/quiz. See "Where this is" for all of these. None of these extends past
  what it names: no OTHER history route, card, quiz content, or link into `/history/bulgaria` from
  the rest of the app exists yet, and no further history countries, content kinds, logic modules
  or UI (dossier, hover, selection, quiz, a second route) without asking again.
- Do not add accounts, a database, or any server call in the first release.
- Do not introduce a map tile provider or API key.
- Do not put secrets in the repo. `.env` is gitignored; `.env.example` is committed.
- Do not use `localStorage` as the primary store — IndexedDB, with a guarded fallback. **One
  documented exception:** the theme choice (`app/lib/theme.ts`) — a per-browser display
  preference, not progress data, and it must be read synchronously before first paint (see
  root.tsx's inline script), which IndexedDB cannot do.
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
