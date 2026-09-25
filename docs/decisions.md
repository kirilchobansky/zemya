sizes say "Top N" because they are a random N-country subset by default (`randomSubset`),
with a toggle for the N most populous (`populationSubset`); "All N" for the

# Decisions, history and known rough edges

Moved out of CLAUDE.md. Nothing here changes what you do on an ordinary task; it records
why things are the way they are. CLAUDE.md's "Where this is" is the short current-state
summary; the per-feature narrative behind it is the first section below.

## What works — detail

**Working:**

- The atlas: canvas map at full 1:10m unsimplified coastline detail, search, neighbour
  highlighting, true-size compare tool, 5 choropleth overlays plus a mastery overlay.
- Renders off-screen world copies and off-screen features culled before fill/stroke, and
  paints from a coarse (detail 0.006) geometry payload while the full 1:10m one loads in
  the background and attaches in place — see CLAUDE.md "## Performance" and performance.md for the target, the
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
  circle micro-state pins use) together with its name from `CAPITAL_ZOOM_FACTOR` (9x homeZoom, later for small
  countries by area, and only once the country itself is a shape — see architecture.md), a "Capitals" toolbar toggle
  (default on), hover tooltip with the city name, and click selecting the _country_ (no
  city page). Suppressed entirely under `quizMode`. See "Places and capitals" in architecture.md.
- Capital name matching (`capitalAliases` on every country record, `matchesCapital` in
  `names.ts`): the authored capital plus a curated list in
  `content/geography/capital-aliases.yaml`, exact after the unchanged `normaliseName`, with
  a build-time collision check — see "Places and capitals" in architecture.md. Nothing consumes it yet
  beyond the tests and the capital quiz.
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
  workaround under "Known rough edges" below, since this bug is exactly why "the tests
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
  every answer — see quizzes.md.
- Run history on the quiz catalogue: clicking a size's best time opens its past runs
  (date, time, first-try/revealed) with a delete control per row — the owner's own data
  about their own performance, removable without a console. `resetAll()`,
  `exportAll`/`importAll` and `saveQuizRun`'s impossible-run guard now all cover
  `quizRuns` too — see "Progress and scheduling" in architecture.md.
- The quiz run screen (queue, timer, pause/resume, abandon, grading, results, personal
  best) is a shared, subject-agnostic engine (`app/lib/quiz/engine.ts`) behind one route
  (`routes/quiz.$quizId.tsx`, `/quiz/:quizId/:scope/:size`) — a second quiz is one
  `QuizDefinition` entry in `app/lib/geography/quizzes.ts`'s `QUIZ_DEFINITIONS`, not a new
  route tree. "Name the Flag" is that second quiz: a flag fills the whole stage area (no
  map), typing the country grades `geo:<ISO3>:flag`, and a small curated list
  (`content/geography/confusable-flags.yaml`) accepts a few flags that are still
  genuinely hard to tell apart (Romania/Chad) for each other, with a note on the real
  difference — see quizzes.md for the mechanism and the design calls made along the
  way.
- Continent scopes on every quiz: a row of chips (World · Africa · Asia · Europe · North
  America · South America · Oceania, from each country's `region`/`subregion`) in each
  quiz's block on the catalogue, a size ladder computed from the pool by one rule,
  personal bests keyed by (quiz, scope, size) with every pre-scope run still counting as
  World — see quizzes.md. The catalogue's quiz
  titles are 28px Fraunces in `--sea`, the whole size card is the link (hover and
  keyboard focus show a `--sea` border), and the flag no longer has a hairline border
  (it drew a false rectangle round Nepal's pennant).
- "Name the Capital", the third quiz: the target country lights up brass with the
  quiz-target ring on its capital, you type the city. Same engine, scopes, size ladder,
  keyboard rules, results and personal best; grades the existing `geo:<ISO3>:capital`
  card; accepts `capitalAliases` and never the country's own name. One `QuizDefinition`
  plus a 20-line Stage over the map Stage the countries quiz now shares
  (`components/quiz/MapStage.tsx`) — see "Name the Capital" in quizzes.md.
- The quiz camera and keyboard follow the player (and resuming from pause no longer resets the
  camera to the world view — `home()` is START only): each new question pans (at the player's
  zoom) or zooms out the minimum only when the target isn't already visible, typing is
  captured document-wide so a canvas click/drag/⌂ can't kill it, and a new target pulses
  once — see "Camera: follows the player", "New-target pulse" and "Typing capture".
- Quiz layouts hold still: catalogue size grids reserve their tallest height, the flag
  quiz's flag sits in a fixed box, and answer/note slots are reserved — the typing field
  and the panel buttons stay at the same pixel for all 197 flags, reveal and twin notes
  included (see quizzes.md).

## History timeline — detail

Moved from CLAUDE.md's "Where this is" (which keeps a one-paragraph summary). The
per-pass narrative of how `/history/bulgaria` got built, owner-requested a step at a time —
see CLAUDE.md's "Do not" for the bounded list of files/pages this covers.

**Data + time-axis engine.** `content/history/bg.yaml` — originally 87 hand-authored entries
(8 periods incl. the overlapping Възраждане, 34 `kind: ruler` entries — the 26 First Empire
rulers 681–1018 plus the 8 heads of state since 1989 — 26 `kind: government` cabinets (prime
ministers) since 1989, 19 tier-1 dates; grown to 680 by a bulk `kind: event` import, see
below), validated and built by `scripts/build-history.mjs`
(`scripts/lib/history.mjs` has the date parser and validator) into
`public/data/history/bg.json`. **Heads of state are `kind: ruler`, not `kind: government`** —
the ruler wire is one unbroken chain across every era (хан, цар, княз, президент);
`government` is cabinets only, and only exists from 1878 on. TODOs left in the YAML for
Second Empire rulers, monarchs 1878–1946 and communist-era leaders.
`app/lib/history/scale.ts` — decimal-year time representation, viewport projection, the zoom
ladder (millennium…day) and tier-based visibility; pure logic, mirroring `app/lib/map/`'s
projection/camera split, so the eventual canvas renderer and `app/lib/map/` can share a shape
without either importing the other. Placed under `app/lib/` to match `core/`, `map/`,
`geography/` — a prompt asking for `app/history/` gets the `app/lib/` sibling instead. It
imports `parseHistoryDate`/`dateKey` straight from `scripts/lib/history.mjs` (typed via a
`.d.mts` sibling, same pattern as `site.mjs`/`site.d.mts`) rather than duplicating the
parser — safe because that module has zero Node dependencies and Vite bundles it like any
other pure module; confirmed by `test/unit/scale.test.ts` importing and running it through
the same Vite pipeline the real app build uses. `app/lib/history/layout.ts` — built on
`scale.ts`: context stack (`contextAt`, what period/ruler/government contains a moment —
gaps are `null`; the ruler and government wires are independent, so a head of state and a
cabinet at the same moment each resolve in their own slot, not each other's), bar-vs-pinned
span classification, per-kind row packing computed from the whole dataset (so a row never
changes while panning), density buckets for the "zoom in, there's more here" cue, and
label-collision resolution. `test/unit/history-mjs-guard.test.ts` asserts
`scripts/lib/history.mjs` imports nothing at all, guarding the assumption `scale.ts`'s import
of it depends on.

**First render.** `/history/bulgaria` — canvas only, no dossier, no hover, no selection, no
quiz; at the time, not linked from anywhere, noindex, prerendered but left out of `indexable`
(the sitemap list) in `react-router.config.ts` (superseded below — it's a real nav section
now). `app/lib/history/renderer.ts` (the cylinder band, tick marks via `ticks()` — with
`placeLabels()` resolving label crowding at borderline zooms, a real defect caught by an
actual render, not by typecheck — the screen-fixed centre marker, and period/ruler bars via
`assignRows()`/`classifySpan()`) and `app/lib/history/timeline.ts` (the `HistoryTimeline`
controller: render-request queue, DPR/resize, drag-to-pan, wheel/pinch-to-zoom). Every draw
function takes `axis: 'horizontal' | 'vertical'` and goes through one `project()` helper —
only horizontal is wired up. `Atlas` (`app/lib/map/atlas.ts`) could not be reused directly
(typed throughout against the 2D geography camera/World/Feature); `HistoryTimeline` copies
its *pattern* — render-request queue, `ResizeObserver`-driven resize, "hold the point under
the cursor/pinch fixed" — one dimension smaller, against `scale.ts`'s `Viewport` instead of
`camera.ts`'s `CameraState`. `app/lib/history/catalog.server.ts` reads
`public/data/history/bg.json` and converts each entry's date string to a decimal year
server-side (`scale.ts`'s `decimalYearOf`, safe to run there — pure logic, not
Node-specific), mirroring `app/lib/geography/catalog.server.ts`.

**Legibility pass.** Bar/pin labels are `name.bg`, not English — this is a Bulgarian
timeline, and both canvas fonts (`--font-ui`/`--font-mono`, i.e. Archivo/IBM Plex Mono)
carry Cyrillic; `HistoryTimeline` also awaits `document.fonts.ready` once and re-renders, so
a frame drawn before the webfont loads gets corrected instead of staying stuck on a
Latin-only fallback. Bar labels truncate-with-ellipsis to their own bar's width (hidden
entirely, bar still drawn, when there's no room even for the ellipsis); every label — ticks,
bars, pins, context-stack lines — is collision-resolved by `placeLabels()`, grouped by
whatever actually shares a line (a lane row; the tick strip) rather than by the whole page,
since two labels in different rows never visually compete. `contextAt` (`layout.ts`) is
generic (`ContextSlot<T>`/`Context<T>`) so its `.primary` carries a `TimelineEntry`'s
`.label` straight through — a non-breaking signature change, re-verified against
`layout.test.ts`'s existing 38 cases. Events (`kind: event`) draw as pins below the
cylinder: stem, dot, "year — name.bg", culled and tiered the same as everything else. The
context stack — period, ruler, government, largest at the top, above the cylinder, centred
under the centre marker, a gap rendered as nothing — reads `contextAt()` against the centre
date on the WHOLE dataset, never the zoom-culled subset, so it's correct at every zoom, not
just the ones with bars on screen. Initial view fits the whole dataset (earliest authored
`start` to today's actual wall-clock year — `Date` used only for that, never for parsing an
authored date) with a small margin, computed once on the first real resize; a later resize
(an actual window resize) never re-fits and so never discards the visitor's own pan/zoom.

Two real defects, found only by an actual browser render (not by typecheck/test:unit/build)
and fixed in the same pass — both are why this route's own checklist asks for a browser
look, not just the usual three commands: (1) `classifySpan`'s pinned `labelPx` and an
event's raw time position are clamped to keep one ANCHOR point on screen; centred text at an
anchor pinned right at the edge still had half of itself rendered off-canvas, so the
renderer now clamps a second time (`clampCentredAnchor`) using the actual measured text
width before positioning or feeding `placeLabels`. (2) Two non-overlapping periods sharing
an `assignRows` row (Byzantine rule, then Second Empire) could both be "pinned" near their
shared boundary with clamped anchors close enough to collide even though their real date
ranges never touch; a plain tier/id tie-break could then hide whichever period the view is
actually mostly inside of behind whichever the view barely touches at the edge. Fixed by
nudging a PINNED candidate's tier (render-time only, never the entry's real editorial tier)
by how much of the visible range its own span covers, so "what's mostly on screen" wins the
tie. Also: an event with no authored `end` was defaulting to `Infinity` (scale.ts's correct
"ongoing" rule for a period/ruler/government's open end) rather than `start` (the correct
rule for a single-moment event), so an undated-end event from any point in the past kept
counting as "visible" — and its pin kept drawing — in every later view; fixed where the
kind-specific meaning belongs, in `catalog.server.ts`'s raw-to-`TimelineEntry` conversion,
not by teaching the generic, kind-agnostic `scale.ts`/`layout.ts` a kind-specific exception.

**Full-cylinder redesign** (supersedes the two passes above — their specifics are no longer
current). The cylinder IS the page now: full canvas width edge to edge, vertically centred,
its own height animated between `CONFIG.minCylinderThicknessFrac` (12%) and
`maxCylinderThicknessFrac` (85%) of `crossSizePx` as a function of zoom
(`cylinderThicknessFraction`, `scale.ts` — log-scale interpolation, since zoom is
multiplicative, smoothstep-eased). `HistoryTimeline` never snaps to that target: `renderNow()`
calls `updateCylinderAnimation()` every frame, exponentially easing `cylinderFrac` toward it
(`CYLINDER_EASE_MS` = 160ms time constant) and re-requesting a frame while still short of it,
so a single discrete wheel notch still animates the cylinder's size over several frames
rather than jumping once. `RenderContext` carries the resolved `cylinderThicknessPx` and
`contentRange` down to the renderer, which treats both as plain snapshots — it has no idea
an animation is happening.

Everything except the centre date readout now lives INSIDE the cylinder. Year ticks moved
onto its own top surface (`drawTopTicks`, `RENDER_CONFIG.tickStripHeight`) — the
tick-thinning logic itself (`niceStep()`/`CONFIG.tickTargetCount`, `scale.ts`) is unchanged
by this pass, only where the marks draw. Below the tick strip, up to four horizontal "wires"
stack in duration order — period, ruler, government, event (`WIRE_ORDER`) — each entry a
rounded capsule (`ctx.roundRect`) filled with a cross-axis gradient in that kind's colour
(dim at the edges, bright through the middle, the same technique as the cylinder's own
gradient) with its Bulgarian name inside, truncated to the capsule's own width. **Governments
now have a real visual — capsules on their own wire — for the first time**; the previous two
passes only ever summarised them as floating text, never drew them at all.

A wire "unlocks" as the cylinder grows, smoothly (`wireRevealAt`, thresholds along the
cylinder's own normalised 0–1 growth: ruler at 0.22, government at 0.46, event at 0.68, each
with a 0.12-wide eased fade-in band) — tied to the cylinder's OWN eased size rather than raw
pxPerYear, so a wire's appearance inherits the same never-a-snap animation for free. A wire
with nothing currently visible gets no row at all, so unclaimed space merges into its
neighbours rather than sitting reserved and blank; within a wire, capsule height and font
size both scale with how much room is actually available right now
(`layoutWires`/`drawWireCapsules`) — "fill the space instead of leaving it empty." Periods
additionally paint a wide translucent band behind everything inside the cylinder, coloured
by the period's stable position in the WHOLE dataset (`periodIndexOf`, computed once from
every period so a given era's wash never changes colour as it scrolls in and out of view)
cycling through a small fixed palette (`PERIOD_BAND_COLORS`) — a judgement call, since the
brief didn't specify per-era colours, made because a single uniform wash across periods that
mostly tile the whole range contiguously wouldn't read as distinct eras at all.

*"The wire containing the centre date is drawn larger and brighter than the others — the
current focus"* is implemented per-CAPSULE, not per-row: for period/ruler/government,
`contextAt` (reused from the earlier passes) finds the one entry whose span contains the
centre date, and that specific capsule draws at `capsuleFocusScale` (1.28×) with a brighter
fill/stroke/text — not the whole wire, since nearly every wire always has SOME entry at the
centre (a period covers the whole range almost contiguously), so highlighting an entire row
would rarely distinguish anything. Events have no "current" concept (a zero-duration moment
either is or isn't the centre, never "the one containing it" among several) and are never
focus-highlighted.

Pan is now clamped to the data's own range padded by HALF A VIEWPORT on each side —
specifically half of whatever the viewport shows at maximum zoom-out, i.e. half of
`contentRange`'s own span (`HistoryTimeline.computeRanges`) — so 681 and today can each be
brought all the way to the centre marker. This needed the zoom-out FLOOR and the pan-CENTER
bound to read from two different ranges, not one: `clampPxPerYear` is called with
`contentRange` (so minimum zoom is exactly "the cylinder fills the viewport with the whole
content span, no padding"), while `clampCenter` is called with the wider,
half-viewport-padded `pannableRange` — both existing `scale.ts` functions, unchanged; only
which range `timeline.ts` hands each one changed. `FIT_MARGIN` and the old 4%-of-span
`RANGE_MARGIN_FRACTION` are both gone: the default/initial view is now exactly that same
zoom-out floor (content fills the cylinder's width edge to edge, no screen-space padding),
matching "the cylinder fills the screen" thematically. Beyond `contentRange` — reachable now
that panning extends that far — the cylinder's brightness fades towards the outer regions
(`drawOutOfRangeFade`, a dark gradient overlay) with a muted centred label once enough of
that empty zone is on screen: "Преди `<earliest year>` — Стара Велика България" on the left
(`earliest year` read off `contentRange.from`, not hand-typed, so it can't go stale if the
dataset's own start ever moves) and "Бъдеще" on the right.

The old floating context-stack text and the old full-height centre line are both gone —
"nothing outside the cylinder except the centre date readout" is now literal: the only thing
drawn outside `[cylinderTop, cylinderBottom]` is `drawCentreDate`. A faint centre line still
exists for legibility (so it's clear which capsule the readout refers to when several sit
close together) but is now clipped to the cylinder's own inner height, which satisfies the
brief without losing that cue.

**Bulk import from events-bg.json.** `content/history/events-bg.json` — 613 auto-generated,
bg-only events with flat `era`/`category` keys (10 eras, 9 categories, each carrying a
`color`) — was imported by `scripts/import-events.mjs`, a one-off migration script (not
idempotent; re-running it throws on the id collisions it created the first time), taking
`bg.yaml` from 87 to 680 entries. Decisions made along the way, not specified by the
import brief itself:
- Two new optional per-entry fields, `category` and `tags` (events only), plus `color`
  (periods and events both) were added to the schema — `scripts/lib/history.mjs`
  validates and passes all three through now. `color` is `"#rrggbb"`, adopted from the
  JSON's era colour (period bands) or category colour (event dots), never hand-picked;
  the app doesn't read any of the three yet.
- The JSON's `principality` (1878–1908) and `kingdom` (1908–1946) eras both fold into the
  one `period-principality-kingdom` bg.yaml already had spanning 1878–1946; that period's
  colour takes the earlier era's (`principality`, `#4a6b8a`) since a period can only carry
  one colour. The JSON's `pre` era (632–680, Стара Велика България) had no period yet — added
  as `period-pre`.
- Dedup against the 19 hand-authored tier-1 events: 21 JSON events matched one of the 19 by
  year and title (two of the 19 are hand-written composites each covering two JSON events —
  the national-catastrophes entry spans Bucharest 1913 + Neuilly 1919, the NATO/EU entry
  spans 2004 + 2007). All 21 were dropped from the import rather than appended as near-
  duplicates. For the 17 clean 1:1 matches, the existing entry's `blurb.bg` was overwritten
  with the JSON's summary (richer than the original one-line blurb); the two composites kept
  their existing hand-written blurb, since no single JSON summary covers both halves.
- Imported entries have no English text (`name.en`/`blurb.en` are both `""`) — the JSON is
  bg-only, and the schema already allows an empty `en`.
- `start` only ever gets `YYYY` or `YYYY-MM-DD`, never `YYYY-MM`: `scripts/lib/history.mjs`'s
  date parser doesn't accept a month without a day, and 58 JSON events have a month but no
  day, so those import as year-only (`precision: year`) despite the JSON carrying a month.
- New ids are `event-` plus a transliterated slug of the Bulgarian title (no library — a
  fixed Cyrillic→Latin table in the script), falling back to appending the year on a
  collision.

## Locked decisions — detail

Moved from CLAUDE.md, which keeps the short list. Do not reopen any of these without asking.

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

## Visual identity — detail

Moved from CLAUDE.md, which keeps the short rule (tokens.css is the single source of truth,
canvas colours are cached once and refreshed only on a theme change, check both themes).

**No longer a single committed dark theme — the owner asked for light mode.** Three states:
System (follows the OS, the default) / Light / Dark, switched from the Layers sheet on
phones and the rail on desktop (`ThemeControls`, `app/components/Rail.tsx`), persisted in
`localStorage` (`app/lib/theme.ts`) and applied before first paint by an inline script in
`root.tsx` — the documented exception to "do not use `localStorage`": it is a per-browser
display preference, not progress data, and must be read synchronously or the page flashes
the wrong theme. Still a chart room in both, not a generic dashboard or a white void: light
is paper-and-ink (off-white page, white land, light blue-grey sea, darker borders, deepened/
desaturated accents), not the dark palette's colours inverted. Do not drift toward the
default "near-black + one neon accent" look, in either theme.

Tokens live in `app/styles/tokens.css`, dark values in `:root`, light overrides under
`[data-theme="light"]` (and mirrored under a bare `prefers-color-scheme: light` for System).
**The canvas cannot read a CSS variable once per frame** — `app/lib/map/renderer.ts`'s
`COLORS` and `app/lib/geography/overlays.ts`'s exported palette are resolved from these
tokens with `getComputedStyle` exactly once (`refreshMapColours()` / `refreshOverlayColours()`),
cached, and re-read only on a theme change (wired up in `app/routes/atlas.tsx`) — never
inside `render()`. This replaced a former exception where `--land` and the micro-state pin
were hardcoded literals in `renderer.ts`; nothing needs hand-mirroring into a `.ts` file
anymore, only the resolved colour cache needs a fallback default (kept equal to the token by
hand, same convention both files now use for every entry, not just those two).

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

Type: Fraunces (display) · Archivo (UI) · IBM Plex Mono (data, labels, timers). Loaded from
Google Fonts with real system fallbacks — the app must stay usable offline, so nothing may
depend on a webfont having loaded.

## What counts as a country — detail

Moved from CLAUDE.md, which keeps the short rule and the count.

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
the ones absorbed into a country's own shape (see "Absorbed territories" above).

## Country aliases and specificity conventions

Moved from CLAUDE.md's Content conventions (the short rule stays there).

- Accepted names in the quizzes are generated (world-countries' spellings), and corrected
  per country with an `aliases:` block in that country's YAML — `add: [...]`, `remove:
  [...]` and a mandatory `note` saying why. Applied after the ambiguity guard, so an added
  alias may deliberately be shared ("Congo" is accepted for both Congos); `remove` must
  name an alias that exists, so an upstream rename fails the build. Today: Thailand drops
  "Thai" (the people, not the country), the UK adds "UK", both Congos add "Congo", and the
  three Saint countries (Saint Lucia, Saint Kitts and Nevis, Saint Vincent and the
  Grenadines) accept "St" as an abbreviation.
- Religion values are deliberately specific (Eastern Orthodoxy, Sunni Islam, Theravada
  Buddhism), not coarse buckets. The faith↔language matching round depends on it.

## Next — full text of the open items

- Indonesia's capital stays Jakarta until a presidential decree moves it (Nusantara
  targeted 2028; re-check before release). The `npm run audit` items are all resolved
  (Sierra Leone SLE, Zimbabwe ZWG, Cuba CUP, Palestine ILS via overrides; the name stays
  "Cape Verde", "Cabo Verde" is an accepted answer).
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

## Known rough edges

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
  incident (see "What works — detail" above) shipped past every one of those checks, including a
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
  ("before this repo is made public"); the Locked decisions table in CLAUDE.md already
  settled that the repo is public now. Left alone deliberately — visibility and
  licensing are different decisions, and only the first is actually locked.
  **Resolved:** the licensing section was replaced by the LICENSE file (code MIT, data
  ODbL-1.0) and README's "Data sources" / "Licence" sections. The data is ODbL because
  `countries.json` derives from world-countries, which is share-alike.

## Absorbed territories

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

## Why the lakes rule exists

Moved from CLAUDE.md's "Do not" list: the Caspian was free (a hole already present in
world-atlas's land layer); the rest genuinely cost something, and that is a decision for
the owner, not a default to reach for.

## Overrides and the `disputed:` mechanism

Moved from CLAUDE.md's Content conventions (the short rule stays there).

- Overrides exist only to close upstream data gaps. Each must carry a `note` saying
  why upstream is wrong and how that was established. Never use an override to express
  an opinion — if a fact is disputed, don't quiz it.
- "If a fact is disputed, don't quiz it" has a mechanism, not just a principle: mark the
  facet `disputed:` in the country's YAML with a mandatory reason (see Nigeria's
  religion). A disputed facet is excluded from the question rotation and from that
  country's mastery denominator; the dossier still shows the value, with the reason on
  hover. Reach for this instead of picking a source and asserting precision nobody has.

## Flag overrides

`content/flags/<iso2>.svg` replaces the svg-country-flags file of the same ISO2 at build
time; `<iso2>.note.md` is mandatory and says what upstream got wrong. Shape and rules mirror
the country `override:` block above. First use: Syria, whose upstream file was still the
pre-2024 Ba'athist flag (the authored `flag:` description was already right).

Colours are not officially specified. Article 6 of Syria's 2025 Constitutional Declaration
fixes band order, the 2:3 ratio and "three red stars" in the white band, and nothing else;
Wikipedia's colour table is annotated "do not revise until flag is officially standardized"
and cites third-party colour sites. `sy.svg` therefore uses the conventional values
Wikimedia's own SVG uses (#007a3d, #ce1126) and its geometry (stars centred on the white
band at 1/4, 1/2, 3/4, bounding height 150 of 900x600). Say so in the note; revisit if an
official specification is published.

## Search and sharing metadata

- **One origin.** `SITE_URL` lives in `.env.example` (committed default) and is overridden by a
  real env var or `.env`; `scripts/lib/site.mjs` resolves it, `vite.config.ts` injects it as
  `__SITE_URL__`, `app/lib/site.ts` exposes `absoluteUrl()`. Nothing else contains a domain.
  The default `https://zemya.example` is a reserved placeholder, not a real site — set the real
  one before deploying.
- **Every route's `meta` goes through `pageMeta()`** (`app/lib/seo.ts`): title, description,
  canonical, og:_, twitter:_. The prerenderer passes `/x/`; canonicals strip the slash to match
  `trailingSlash: false`. Legacy redirect pages are `noindex` and stay out of the sitemap.
- **Quiz titles** come from `quizPageSeo()` (`app/lib/geography/quizSeo.ts`) plus `seoName` /
  `seoTask` on each `QuizDefinition`: "Africa Capitals Quiz — Top 30 Countries | Zemya". Numeric
  sizes say "Top N" because they are a random N-country subset (`randomSubset`); "All N" for the
  rest. Pool size comes from a build-time loader.
- **Sitemap and robots.txt** are written by `buildEnd` in `react-router.config.ts` from the same
  list that `prerender` uses. A `VERCEL_ENV=preview` build gets a disallow-all robots.txt, and
  `vercel.json` sends `X-Robots-Tag: noindex, nofollow` on every `*.vercel.app` host (production
  included, since each deployment is also reachable there). **If `SITE_URL` were ever a
  `*.vercel.app` host, that header would deindex it** — use a custom domain.
- **JSON-LD.** schema.org `Country` has no capital, population or currency properties, so those
  go in `additionalProperty` `PropertyValue`s rather than invented fields. Google has no rich
  result for Country; this is valid structured data, not a promised rich snippet. `WebSite` on `/`.
- **Headings.** A page's h1 is its subject: the dossier's country name is the h1 and the rail's
  wordmark drops to a `div` on `/country/*`; it is the h1 elsewhere.
- **og:image** is one committed 1200x630 card (`public/og-image.png`, from
  `scripts/build-og-image.mjs`). Later idea, not built: per-country cards.
