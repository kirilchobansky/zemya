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
  circle micro-state pins use) above `CAPITAL_DOT_ZOOM_FACTOR` (6x homeZoom, the 500 km scale, and
  only once the country itself is a shape) with the
  name beside it above `CAPITAL_LABEL_ZOOM_FACTOR` (9x), a "Capitals" toolbar toggle
  (default on), hover tooltip with the city name, and click selecting the *country* (no
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

## Next — full text of the open items

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
