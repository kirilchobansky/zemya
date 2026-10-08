(see "Scopes" below), randomly selected from the chosen pool by default (`randomSubset`),
or population-ranked when the order toggle is switched on (`populationSubset`); a quiz
South America is the subregion, North America is every other Americas country — 197 / 54 / 48 /
46 / 23 / 12 / 14), and "top N" means a random N-country subset _within_ that pool by default;
the control below the continent buttons switches it to the N most populous. The old,

# Quizzes reference

Look-up material moved out of CLAUDE.md: the route shape, scopes, size ladder, personal
bests, the engine/presenter split, quiz mode, camera-follow and typing capture. Read it
when the task touches `app/features/quizzes/engine/`, `routes/quizzes/quiz*.tsx`, `app/features/quizzes/geography/stages/` or
`app/features/quizzes/geography/quizzes.ts`. Card model and scheduling internals:
[architecture.md](architecture.md).

## Quizzes

The owner's own words on why this exists: "the reason i want this app is the quizzes
actually. Not the detail not anything else." — treat this as the app's core loop, not a
feature alongside the atlas and study mode.

**Subjects.** A thin layer sits above the quiz catalogue: `/quizzes` (`routes/quizzes/quizzes.tsx`)
picks a subject (Geography, History), `/quizzes/:subject` (`routes/quizzes/quizzes.$subject.tsx`)
lists that subject's quizzes (History adds a country level, below), and a run is `/quizzes/:subject/:quizId/:scope/:size`
(`routes/quizzes/quizzes.$subject.$quizId.tsx`). `app/features/quizzes/engine/subjects.tsx` is the registry: `{ id,
name, blurb, quizzes: QuizDefinition[] }`; geography's `quizzes` is the same
`QUIZ_DEFINITIONS` array below, unchanged, and history's is empty (`fillQuizzes: true` instead —
its quizzes are listed per country, see "History: fill the list"). This is UI scaffolding
for the picker, **not** a start on history content — see CLAUDE.md's Do Not section on
subjects, and its note on this specific deviation. The old flat `/quiz`, `/quiz/:quizId/:scope/:size`
and `/quiz/:quizId/:size` paths (indexed on Google before this layer existed) are kept as
permanent redirects to their `/quizzes/geography/...` equivalent (`routes/quizzes/quiz.tsx`,
`quiz.$quizId.tsx`, `quiz.legacy.tsx` — now three thin redirect stubs, prerendered as static
files since a host with no server can't redirect a URL that isn't a real page). Quiz ids
(`countries`, `flags`, `capitals`) are unchanged — personal bests in IndexedDB are keyed by
them, not by any route shape.

**Route shape (within a subject).** `/quizzes/:subject` lists a subject's quizzes, built
from `app/features/quizzes/geography/quizzes.ts`'s `QUIZ_DEFINITIONS`/`QUIZ_SIZES` for geography. Every
run, of any quiz, is served by one route: `/quizzes/:subject/:quizId/:scope/:size`
(`routes/quizzes/quizzes.$subject.$quizId.tsx`), which looks the id up within that subject
(`quizInSubject`) and renders that definition's `Stage` — a quiz id only resolves inside its
own subject, so `/quizzes/history/countries/...` 404s rather than quietly serving geography's
quiz. A second quiz ("Name the Capital" — since built) is one new `QuizDefinition` entry,
never a new route tree or a rewrite of the list page — this is what let "Name the Flag"
arrive as a ~50-line presenter (`features/quizzes/geography/stages/FlagsStage.tsx`) plus a registry entry,
reusing everything else. The list itself is compact — quiz names only — with one quiz's
scope chips and size ladder expanded inline at a time, collapsed by default; same markup on
desktop's right panel and the phone sheet. Sizes come from `app/features/countries/scopes.ts`
(see "Scopes" below), randomly selected from the chosen pool by default (`randomSubset`),
or population-ranked when the order toggle is switched on (`populationSubset`); a quiz
that shouldn't use either shared order would pass its own list into the shared engine instead.

**Scopes.** Every quiz has a continent filter, in the shared catalogue and engine, not
per quiz. Route: `/quizzes/:subject/:quizId/:scope/:size`, scope one of `world | africa |
asia | europe | north-america | south-america | oceania`; the pool is
`poolForScope(countries, scope)` (`region`, plus `subregion` to split the Americas: South
America is the subregion, North America is every other Americas country — 197 / 54 / 48 /
46 / 23 / 12 / 14), and "top N" means a random N-country subset _within_ that pool by default;
the control below the continent buttons switches it to the N most populous. The old,
pre-subject `/quiz/:quizId/:size` (pre-scope too) still exists as `routes/quizzes/quiz.legacy.tsx`,
now a redirect straight to `/quizzes/geography/:quizId/world/:size`, and is prerendered for
the old sizes so bookmarks to a static host still resolve. A removed scope key
(`LEGACY_SCOPES` in `scopes.ts` — today just `americas`, split in two) redirects to its
replacement (world) and is prerendered for the sizes it once offered, under both the old
`/quiz/:id/americas/:size` prefix (`routes/quizzes/quiz.$quizId.tsx`, a redirect stub to the
`/quizzes/geography/...` equivalent) and inside the real run route itself (which still
carries the `americas` -> `world` check, for a URL someone types by hand under the new
prefix); a size the pool can't offer (typed into the URL by hand) redirects to
`/quizzes/:subject`. `scopes.ts` is deliberately dependency-free (no `~` alias, no React):
`react-router.config.ts` imports it directly to derive the prerendered
`/quizzes/geography/:id/:scope/:size` set (and the old `/quiz/:id/:scope/:size` redirect
stubs, same combinations) from `countries.json`, so adding a country changes both the
offered sizes and the prerendered pages with no list to edit. The list page reads the same
pool sizes from a build-time route loader. A new quiz is one id in that config's `QUIZ_IDS`
plus its `QUIZ_DEFINITIONS` entry — subject membership is separate, in
`app/features/quizzes/engine/subjects.tsx`.

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

**The engine/presenter split.** `app/features/quizzes/engine/engine.ts`'s `useQuizEngine()` hook owns a
run end-to-end — question order, the current target, attempt state, timer accumulation,
pause/resume, abandon, per-answer outcome, completion, the results payload, the
personal-best write and FSRS grading — and is deliberately ignorant of maps, flag images
or anything else a Stage renders; it knows a list of countries and a callback per answer.
A `QuizDefinition` (`app/features/quizzes/engine/types.ts`) is `{ id, title, description, facet, Stage,
prepare?, match?, markCapital? }`: `facet` says which FSRS card an answer grades
(`geo:<ISO3>:<facet>`), `Stage` is the component that renders what the player sees,
`prepare(targets)` is an optional lookahead hook for preloading something heavier than a
name (the flags quiz preloads SVGs three questions ahead — the heaviest are 200+ KB and a
mid-run hitch would feel broken), and `match(typed, target)` is an optional acceptance
rule layered on top of the plain name match every quiz gets for free (see confusable
pairs below). `description` and `match` aren't in the minimal shape first sketched for
this split; both turned out to be needed once the catalogue text and the flags quiz's
confusable pairs were actually built, so they're recorded here rather than only in a
commit message.

`app/features/quizzes/pages/use-quiz-atlas-bridge.ts` (used by `QuizRun.tsx`; the route file `routes/quizzes/quizzes.$subject.$quizId.tsx` only loads data and dispatches) is the "atlas bridge": it owns the handful of things every quiz
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

**Quiz mode is one flag, not four conditionals.** `routes/quizzes/quizzes.$subject.$quizId.tsx` reaches the
map through `useAtlasContext()` (exported from `features/map`) and writes a `quiz:
QuizOverride | null` there for the whole lifetime of the route (set on mount, torn down on
unmount), for every quiz alike — the subject/quiz list pages never touch it. Setting it
non-null does these things, all gated on that one value: the renderer's `Style.quizMode`
suppresses `drawLabels()` entirely — country AND capital names — and the capital rings and
their hit-testing (`renderer.ts`); `atlas.tsx` stops rendering the search box and the hover
`.tip` (which is also where a capital's tooltip would show); and the neighbour glow defaults off, driven by
`quiz.showNeighbours` rather than the normal toolbar's `showNeighbours` state (only the
countries quiz's Stage renders a toggle for it — see the engine/presenter split above).
Fill/stroke while active come from `quizFillFor`/`quizStrokeFor` (`geography/overlays.ts`)
instead of the normal `fillFor`/`strokeFor` — answered-correct green (`--master`), answered-revealed
red (`--new`), the current target brass (`--brass`), everything else plain land; no overlay, hover or mastery
colouring applies mid-quiz. Anyone adding a fifth surface that could show a country's name
should gate it on this same `quiz`/`quizMode` value rather than inventing a new flag.

**Nothing moves when content changes size.** The player's eyes and hands are anchored on
the input, so no Stage may change its position, ever. The flag lives in a fixed 460x300
box (`.quiz-flag-stage__flag`) — only the flag inside it changes size (Qatar fits by
width, Nepal by height) — and the revealed-answer chip and the panel's accepted-twin note
each have a slot of reserved height (`.quiz-feedback`, `.quiz-run__note-slot`) that is
always present and simply empty. New quiz Stages follow the same rule. The quiz list
follows it too: each quiz's size grid (once expanded) reserves the height of the tallest
grid any scope can produce (`--max-rows` from the data x `--card-h`), so a chip that shrinks
one quiz's grid never shoves anything below it. Checked by clicking every chip and by
skipping through all 197 flags and comparing the input's box.

**Continent quizzes: the continent is "home".** In a continent scope the run's home view is
that continent, not the world. `SCOPE_VIEWS` (`scopes.ts`) holds a hand-set lon/lat box per
scope — hand-set, not derived from the pool, so Russia's far east or Kiribati's outliers
can't drag the frame out over ocean; Oceania's runs past 180 on purpose. The route calls
`Atlas#setRegionView(box)` on mount (and `home()` so the continent is framed behind the
START dock) and clears it on unmount; `Atlas#home()`, `homeIfZoomedIn()`, the results
screen, ⌂ and the follow rule's "at the overview" test (`QUIZ_WORLD_VIEW_FACTOR`) all read
that one `homeView()`. World scope has no entry and behaves exactly as before. Boxes were
looked at, not tuned; a target that doesn't fit (Russia in Europe) still zooms out the
minimum. Smoke step 21 covers it.

**Colours: three meanings, three colours.** Brass = the question, red = "you didn't know this
one" (revealed), green = got it. Revealed used to be `--learn` amber, which is the _same value_
as brass (`#E8A33D`), so mid-run a revealed country looked like the current question. Red is
the mastery colour for "new / not known", so it is right semantically, not just a different hue.
One function (`quizFillFor`) paints all three quizzes, so they cannot disagree; the flags quiz
has no map, and its revealed-answer chip carries the same red outline. Pinned by a unit test.

**Camera: one path for every new question (supersedes "follows the player" and "never moves
again" below).** START still calls `atlas.home()` once. After it, every NEW question — a correct
answer, a skip, a reveal-then-answer — runs `Atlas#followTarget`, and that is the _only_ place the
quiz camera decides (`follow.ts` is the pure maths under it). Earlier, the route called
`homeIfZoomedIn()` for a guess and not for a skip, so the two behaved differently; that decision
now lives in one function, and the route just calls it when the target changes. Two steps, one
animation, decided against where the camera is _heading_ (`Atlas#target`), so quick answers chain:

1. `cameraForTarget` from where the camera is. If it says "leave it", done — even zoomed in. If it
   wants to move AND the player is zoomed past `QUIZ_WORLD_VIEW_FACTOR` (1.25x home), start again
   from the home view (the continent, in a continent scope).
2. `cameraForTarget`: **(a)** whole box inside the visible area (`QUIZ_VISIBLE_MARGIN`, 2%) and big enough -> leave
   it; **(b)** too small -> zoom **in** until legible, even off the overview; **(c)** too big ->
   zoom out the minimum to fit; **(d)** otherwise SLIDE it just into view (least shift per failing axis, to the comfort margin) — never a re-centre, unless the zoom changed.

- **Comfortable** = inside the visible area by `QUIZ_COMFORT_MARGIN` (10%) of each dimension, or the
  floor for the target kind (12 px shape, 48 px pin, 60 px capital dot). `QUIZ_FRAME_PADDING` is
  _derived_ (`1 - 2 x margin`), so a country zoomed out to fit is comfortable by construction.
  Touching the edge, or a 12 px margin, was "visible" before — a sliver you had to squint at.
- **Legible** = at least `QUIZ_MIN_TARGET_PX` (12) wide, the same measure the renderer uses to
  decide pin vs shape (`PIN_MAX_WIDTH` 7 in `thresholds.ts`), so a target is never left as a pin.
  The capitals quiz needs `CAPITAL_MIN_SHAPE_WIDTH` (17.2) so its ring has an outline to sit on.
  **Tuned by playing all 197**: at 24 px, 63% of questions zoomed and the near-world view (which the
  owner asked to keep) was gone; at 12, ~37% do and only ~13 (the micro-states) go past 10x.
  Measured, not guessed — but a judgement; raise it and more mid-size countries zoom.
- A country whose minimum width is **unreachable even at max zoom** (Vatican City: degenerate
  geometry, a pin at every zoom) has no width to guarantee; it gets neighbourhood zoom
  (`NO_SHAPE_ZOOM_FACTOR`, 34x) rather than the 320x cap, which showed a pin on empty ground.
- **What covers the canvas is only the docked quiz input** (`.quiz-dock`, measured by
  `measureInsets()` in the route into a bottom inset). **The brief said the right panel sits
  on top of the canvas; it doesn't** — it is a grid column beside the stage (confirmed again by a
  screenshot), so "behind the panel" is simply off the canvas, and the comfort margin from the
  canvas edge covers it. The bottom-left zoomer/scale bar are not modelled (a small corner).
- The camera target is the country's **mainland cluster** (`mainlandBox`): largest polygon
  plus any >= 2% of its size within 3 of its diagonals — France without Guiana, Indonesia
  with Papua. In the capitals quiz only the capital's dot has to be comfortably in view (Russia's
  capital is findable without fitting Russia), but the size rule still applies to the country.
- At the overview y is clamped, so a target near the top or bottom can't be centred vertically;
  only x is recentred. A country hugging the side of the world slides the map sideways to centre.
- The flags quiz (`hidesMap: true`) skips follow and pulse; nothing on screen uses them.

**Capital dot vs outline.** A capital ring, its name and its hit-test all go through one
predicate (`capitalShapeShowing`): the country must be drawn as a shape _and_ at least
`CAPITAL_MIN_SHAPE_WIDTH` wide — `PIN_MAX_WIDTH` plus the ring's own diameter, derived in
`thresholds.ts`, so the two cannot drift. Before, a 10 px ring appeared on a 7 px sliver: a dot
floating beside a country that hadn't formed yet. In the quiz, the target ring is not drawn beside
a pin at all (the pin carries its own). Sweep-tested in `renderer.test.ts` across every zoom.

**New-target pulse.** `Atlas#pulse` draws one brass ring growing 8 -> ~98 px and fading over
1000 ms (`renderer.ts`'s `Pulse`), anchored in map space on the country's anchor (or the
capital dot) so it stays on target while the camera pans. Once, not a loop: the rAF loop
ends when the pulse does, so it costs nothing in steady state (`npm run perf` unchanged,
16.7 ms median). Purely a paint — no layout, no camera, no input handling. Skipped under
`prefers-reduced-motion`.

**Typing capture (engine.ts).** While `running`, a document-level `keydown` listener focuses
the quiz input for any printable key or Backspace pressed with focus anywhere but a text
field, and lets the keystroke land in it (it does NOT `preventDefault`; the browser delivers
the character to the newly focused input, so the first letter isn't lost — verified by
typing whole names from an unfocused state). Ctrl/Alt/Meta held: ignored. Tab (skip) and
Ctrl+Enter (reveal) are handled there too, because with focus on a button they otherwise
never reach the input's own handler; when the input has focus the listener returns first, so
nothing fires twice. Esc/Ctrl+Backspace were already window-level. The old phase-change
`focus()` stays only as initial focus. The canvas has no `tabindex` and never did — the bug
was that clicking it blurs the input. **Consequence: ⌂ is the manual escape hatch** (click,
keep typing), so there is deliberately no new reset shortcut. **⌂ used to `navigate('/')`,
which unmounts the run and silently abandons it** (found by the smoke test); during a run it
is now only a camera reset.

**Camera: little to no zoom, on purpose (history — the START part still holds).** The first version of this flew the camera to
each question with custom quarter-viewport-width framing (`camera.ts`'s `frameForQuiz`,
reading a `feature.mainBbox` built from clustering a country's polygons so a remote
exclave like Chile's Easter Island didn't drag the frame out over open ocean). The owner
overruled this after using it: the per-question zoom was too aggressive, and the point is
to keep the sense of the whole world, not to be flown around it question by question. That
whole mechanism (`frameForQuiz`, `Atlas#flyToQuiz`, `feature.mainBbox`, the polygon
clustering in `topology.ts`) was removed rather than left dead. **A run now calls
`atlas.home()` once, on START** — and, as first written, never moved the camera again; that
second half is superseded by "one path for every new question" above.
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
itself is only _visually_ dimmed (`.quiz-dock__input--paused`) and its keystrokes are
ignored in `handleInputChange`'s own phase check, so it stays focused and every shortcut
keeps working. General lesson: a keyboard shortcut that is supposed to escape a state must
not be attached only to a DOM node that state disables.

**Abandon.** `Ctrl+Backspace` (also a button) quits a run outright — nothing saved, no
`quizRuns` row, no FSRS grading for anything answered so far — and returns to
`/quizzes/:subject`. Deliberately just a `navigate()` back to the subject's quiz list: the
route unmounting is what already tears the `quiz` override down (see its mount effect), so
there is no local state to reset first.
Not a bare key, and not Esc (already pause) — a bare letter would fire while typing a
country's own name (e.g. "Qatar").

**Restart.** A secondary "Restart" button, visible only while a run is active (running or
paused): in the panel's controls next to Abandon, and on the phone pause screen next to
"Abandon run". It starts a NEW run on a NEWLY DRAWN set of the same scope, size and
selection mode: the route calls `selectQuizCountries` again (random subsets differ; population /
Top-N and size "all" come back as the same set, just reshuffled), keeps it as an override of the
`countries` memo (so "N rounds" follows) and calls `engine.restart(next)`, which holds the set
as its run list (totals, results and the progress counter follow it); it is focused inside the
tap. Nothing saved, no FSRS grading for answers given so far. "Try again" (formerly "Run it again") returns to the quiz's start screen on a newly drawn set (like Restart; not an instant run); Back (mid-run or on the results) and Abandon go to the list with the quiz open (`listReturnState`, features/map/up.ts); Name all countries behaves the same, its Restart also returns to its start screen
Before the start and on the results screen
nothing changed. The History fill quiz has the same button in its input bar (running or
paused), doing exactly "Try again".

**Review mistakes (geography quizzes):** on the results, next to "Try again" and only when something was revealed, a neutral (non-primary) `.action` button, "Review mistakes (N)", starts a run at once on exactly the revealed countries (`engine.reviewMistakes`, `reviewing` flag). Skipped-then-answered countries do not count as mistakes. A review run is graded by FSRS like any run and is never a personal best; it writes no row of its own: its time is appended to `reviewTimesMs` on the full run's `quizRuns` row (second try, third try, ...; `timeMs` stays the first try) with `reviewMissedCounts` beside it (countries still revealed in that pass). The archive row keeps date, size and the first time, and its tally is "known/total last attempt": `4/10 first try`; after a review that misses 3 of the 6, `7/10 second try`; 9 then a clean review of the 1 → `10/10 second try`; then "third try", "4th try", ... without end. Only finished passes count (abandon and restart save nothing); the review times are the tally's tooltip (covered by export/import, it is a field of the same row). Its header reads "Review · N"; if some are revealed again the button is offered again. "Try again" leaves review mode for a fresh draw.

**Fill quiz typing capture:** while a fill run is idle or running, a printable key or Backspace aimed at anything that is not a text field focuses the input first (`use-fill-run.ts`, same rule as the geography engine's), so the first letter is not lost after a click elsewhere.

**Quiz zoom on a phone:** a viewport narrower than `NARROW_VIEWPORT_PX` (520) uses `quizFollowOptions` (`follow.ts`): the smallest a target may be is 18 px wide (12 on desktop), a shapeless country gets 16x home zoom (34x), and zooming IN stops at 20x home (`maxZoom`; a camera already closer is never pulled back). Measured on all countries from the overview with a 390 px phone strip: before, the median question zoomed 1.7x, a quarter stayed on the overview with a speck of a country, and micro-states went up to 166x; after, median 2.5x, max 20x. A second pass pulls mid-sized countries closer: a target narrower than `NARROW_COMFORT_WIDTH_PX` (80 px) is brought toward it by `(80/width)^COMFORT_PULL` (0.7), at most `NARROW_COMFORT_MAX_FACTOR` (10x) home zoom, so the smaller the country the closer, never all the way (Germany ~4x, Poland 4x, Brazil 1.5x, Russia, Canada and the USA stay on the overview — the world view is as far out as the camera goes). `NARROW_FRAME_PADDING` (1.1) lets a zoomed-out-to-fit country overflow the strip slightly rather than shrink. Median question on a 390 px phone: 5x, max 20x. Desktop is unchanged. All the numbers are exported constants at the top of `follow.ts` (phone block), tuned by measuring all countries, not by feel.

**Give up (geography quizzes):** a "Give up" `.action` in the running panel and a button on the phone pause screen (beside Abandon, which still leaves the run) calls `engine.giveUp`: the run ends where it stands, every unanswered country joins `revealedSet` (so it is missed — red on the map, listed on the results, offered by "Review mistakes (N)"), and `result.gaveUp` is set (header "Gave up"). Like Abandon nothing is saved: no `quizRuns` row (`savedRunRef` resolves to `undefined`, so a review pass of a given-up run appends its time nowhere), no FSRS grading, never a personal best. Name all countries had its own Give up already.

**Results map (geography quizzes and Name all countries):** once a run is over the map shows country names, hovering shows the usual name tooltip and a click on ANY country, guessed or missed, opens its dossier with "← Back to quiz results" (above). Mechanism: `QuizOverride.onInspect` (set by `engine/use-results-inspect.ts` only while the phase is done / gave up, removed on any new run, review pass included) — `quizNames` on the renderer `Style` draws the country labels although `quizMode` is on (no zoom threshold, they appear as soon as they fit; capital names stay off) and `MapNotices` shows the tooltip; `handleSelect` calls `onInspect` instead of ignoring the click. During a run, a review pass included, none of it exists: a name on the map would be the answer. The one place that decides is `onInspect`'s presence.

**Review pass painting:** a review replays only the missed countries, but the map keeps the rest of the full run green: `engine.settled` = `settledMarks(...)` (`run-result.ts`) = the full run's other countries as `correct` plus this pass's own answers; only the countries under review start unmarked. The full run's list lives in `use-quiz-review.ts` (`fullList`, kept across a review of a review, null otherwise and in the snapshot). `restoreResult` also repaints the map from the restored run (it used to come back unpainted).

**Back from a dossier to the results (geography quizzes and Name all countries):** a missed country on the results links to `/country/:slug` with location state `{ quizReturn: { to: <run path + search>, token } }` (`quizReturnState`, features/map/up.ts). Following the link parks the finished run in memory (`engine/finished-runs.ts`: one entry per run URL; result, the set played, `revealedSet`, `reviewing`, the archive-row promise; no IndexedDB, no localStorage, no table). A dossier with that state shows a neutral `.action` "← Back to quiz results" (`features/map/components/QuizReturnBack.tsx`, inline in the panel body so it works in the phone sheet, nothing fixed); any other dossier is unchanged. **Decision: Back is a fixed return, not history** (as Up): the dossier's neighbour links carry `quizReturn` along, so after several dossiers Back still lands on the results, and it replaces the dossier's history entry. It navigates to the run URL with `{ restoreRun: token }`; `QuizRun` calls `engine.restoreResult` (state only, in `use-quiz-review.ts`, which also owns `result`/`reviewing`/the archive-row ref) once the world is loaded, only if the saved entry's token matches. Nothing is archived, graded or counted as a best again; "Review mistakes" works on the restored list and appends its time to the same archive row; after a review pass, Back restores that pass. A reload, direct visit or lost memory falls back to the start screen. Name all countries does the same through `useNameAllRun`'s `snapshot`/`restoreResult` (phase done or gave up, named list, time, outcome; the saved run is not saved again, a given-up one never is); both screens share `engine/use-results-return.ts`. **Camera:** following a results link calls `holdQuizCamera()`, so the quiz screen's unmount skips its usual `home()` and the continent you were quizzing (Africa) stays framed in the dossier; the dossier itself never flies. On landing the usual finish `home()` re-frames the scope. Gating is unchanged: the restored screen is the ordinary `done` phase.

**Enter after a reveal.** Once the current target is revealed (Ctrl+Enter / Reveal button),
plain Enter — in the input or, like Ctrl+Enter, with focus elsewhere (not on a button/link,
which keep their own Enter) — puts the reveal's answer string in the input for 250 ms
(`REVEAL_FILL_MS`), then accepts it through the same `commitAnswer` a typed match uses, so it
scores as outcome "revealed", rates `again` and advances identically. Accepted by construction,
not re-matched (the reveal text, e.g. all languages or "Euro (EUR)", need not be matchable).
Enter with nothing revealed does nothing; typing the answer by hand still works and cancels a
pending fill. A phone's Go/Done key sends Enter. While revealed, a hint sits by the answer
("Press Enter to fill it in", phones: "Tap Go to fill it in"). The answer string comes from
`QuizDefinition.answerOf` (default: the country's name), shared with the Stage's reveal chip.
Tests: `app/features/quizzes/engine/engine.test.ts` (a tiny hook runtime stands in for React — no DOM in
the unit environment).

**Feeding the spaced repetition.** Every answer grades that country's
`geo:<ISO3>:<definition.facet>` card (`app/features/countries/mastery.ts`'s `cardId`) through
the normal `review()` from `useProgress()` — the same path study mode uses. For the
countries quiz that's `location`, graded here even though study mode still can't ask it
(`ASKABLE_FACETS` excludes it) — that's intentional, the quiz _is_ the location question,
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
personal best — its `QuizDefinition` (`app/features/quizzes/geography/quizzes.ts`) is a `Stage`
(`features/quizzes/geography/stages/FlagsStage.tsx`, no map, the flag filling the stage area with the
input directly under it), `facet: 'flag'`, a `prepare()` that preloads the next three
flags' SVGs, and a `match()`. True aspect ratios (see "Real flag images" in decisions.md) solve most
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

**"Name the Capital".** Third `QuizDefinition` (`quizzes.ts`), route
`/quizzes/geography/capitals/:scope/:size` (22 prerendered combinations, from the same ladder). What the
player sees is the countries quiz's screen: the target country in `--brass`, the map at
(roughly) the world view, an input docked at the bottom. `markCapital: true` on the
definition puts `showCapital` on the `QuizOverride`, which `atlas.tsx` turns into the
renderer's `Style.quizPlace` — the target's own capital, drawn as two concentric ink rings
(`drawQuizPlace`) at **any** zoom, because the ordinary capital rings only exist above 9x
and the quiz stays near 1x. Every _other_ capital ring, every place label and every place
tooltip stay off under `quizMode`. **The highlight is the question** — nothing on screen
names the country, and nothing names the city until a reveal.

- `match` always returns an outcome (`{ accepted: matchesCapital(...) }`), never `null`,
  because `null` makes the engine fall back to the _country_-name matcher and "France"
  would answer "capital of France". (Countries whose accepted capital names include their
  own name — Panama, Guatemala, Kuwait, Andorra, Luxembourg — accept it on purpose.)
- `MapStage.tsx` is the shared map Stage; `CountriesStage`/`CapitalsStage` are one config
  each (placeholder, aria-label, what a reveal shows, whether the neighbour-glow toggle
  exists). The capitals quiz has **no** neighbour-glow toggle — the country is already
  lit, so it has no job there. Say so if you want it.
- **The brief asked for "the countries-quiz camera framing… the target country framed with
  its continent around it". There is no such framing to reuse:** the per-question framing
  was removed on the owner's instruction (see "Camera: little to no zoom, on purpose"), so
  the capitals quiz does what the countries quiz does — `home()` on START, then the shared
  follow-the-player rule (its target is the capital DOT, with a 60 px margin).
  Framing a continent per question would be new behaviour that reverses that decision, so
  it was not built. Tell me if a continent-level frame (not the old quarter-viewport zoom)
  is actually wanted.
- Where the target's capital sits under a pin-drawn city-state (Vatican, Monaco, Singapore),
  the target pin's own ring is the marker and the quiz ring is skipped (same 6 px rule as
  `drawCapitals`).
- `tests/e2e/areas/quiz-kinds.mjs` (capitals) is the label-leak test: START on `/quizzes/geography/capitals/world/20`, read
  the target from `window.__zemyaQuiz` (now with `targetCapital`), then scan **every text
  node and every `aria-label`/`title`/`alt`/`placeholder`/`value`** — whole-word,
  case- and diacritic-insensitive, `<script>`/`<style>` skipped — for the target's capital
  and country name, before and after answering. It also has a **positive control**: after a
  Ctrl+Enter reveal the same scan must find the capital, or the "not visible" checks prove
  nothing. Typing the country's name must not advance the run (skipped for the handful of
  countries whose capital names include their own).

**"Name the Currency / Language / Religion".** Three more `QuizDefinition`s (`quizzes.ts`) on the
capitals quiz's screen (`features/quizzes/geography/stages/FacetStages.tsx` -> `MapStage`): the target country is lit
in brass, no marker, and the player types the value; grades `geo:<ISO3>:currency|language|religion`.
Scopes, ladder, keys and colours are shared. THE ANSWER IS NOT UNIQUE (twenty countries are "Euro"),
which is fine for country -> value; there is no value -> country quiz, and no cross-country alias
collision check. Each `match` always returns an outcome, so typing the country never scores.
- **Language** accepts ANY entry of `languages` (`language` is only the alphabetically first — Argentina
  = Guaraní, Belgium = German); a reveal lists them all.
- **Aliases** are one YAML per facet, `content/geography/{currency,language,religion}-aliases.yaml`,
  keyed by VALUE (`- value: Spanish / add: [Castilian] / note`), not by country as capital-aliases are —
  an alias like Castilian applies to every Spanish-speaking country. `build-content.mjs` throws on an
  unknown value, a missing note, and an alias that is empty, repeated within the facet, or equal to
  some value's own name (so diacritic-only variants and "Romanian"-for-Moldavian are refused). Result on
  each record: `currencyAliases` (name + ISO code + aliases), `languageAliases` (all languages + aliases),
  `religionAliases` (value + each " / " component + aliases). Currency: never a bare "dollar", "franc",
  "peso", "pound", "krona" (~20 currencies share each). Religion: synonyms that keep the distinction
  (Catholic, Orthodox, Sunni); a term broader than the country's value (Islam, Christianity) is rejected
  at match time (`matchesReligion`, via `questions.ts`'s `BROADER`) and a unit test asserts it for all
  countries.
- **Pools**: `poolForQuiz` (`scopes.ts`, `QUIZ_POOL_FILTERS`) drops a country whose facet is missing or
  `disputed:` (Nigeria's religion). Run route, list page (pool counts are per quiz id, then scope) and
  prerender set all use it, so the size ladder adapts by itself.
- Study mode's `language-of` question now picks one of the country's languages at random, uses
  distractors that are none of them, says "an official language" when there are several and shows the
  full list afterwards (`Question.note`); the dossier already listed all languages and the country page
  description now does too. The data has no "primary language", so none is shown.

**Personal best.** Every finished run is appended (never overwritten) to a `quizRuns`
table in the same Dexie database as `cards`/`reviews` (`app/features/progress/progress.ts`) —
`bestQuizTime()` reads the fastest for a given quiz+size, shown on the quiz list's size
cards and on the results screen ("beat your best" / "personal best stays"). Deliberately
left out of the JSON export/import format: a personal best is local flavour, not learning
progress, and folding it in would force `SCHEMA_VERSION` to move over an additive table.
Revisit if the owner wants best times to survive a device move.

**Best time vs archive (geography).** Two different things. The **archive** is every finished
run, whatever its size, kept per (quiz, scope, mode): an "Archive" chip in the opened quiz lists
all of them together (top 10, top 20 ... All, each row with its size), each deletable. Each row
records its `mode` (`random` | `population`; rows without one read as random; Name all has no
mode). A **best** is per (quiz, scope, size, mode) — a top-10 run never competes with the All
run — shown on the size card, and only a **perfect** run can be one: nothing revealed and
nothing skipped (`QuizRunEntry.perfect`; older rows fall back to `firstTryCount === totalCount`).
An imperfect run is archived and the results screen says it is not a best. Name all and the
History fill quizzes only save clean finishes, so every run of theirs is perfect; fill quizzes
keep their own best per toggle setting.

**Results screen.** On the last correct answer the camera pulls back to the world view
(`atlas.home()`) while the finished map stays coloured (green/red, from the `quiz`
override, which is only cleared on unmounting the route) and the panel shows the time,
the personal-best comparison, a first-try-vs-revealed tally, and every revealed country
as a dossier link — "the ones worth another look", the actual point of the screen.

## Geography: "Name all countries" (`name-all`)

A free-recall quiz: no prompt, no target — the player types country names in any order until all
are named or they give up. Seven runs, one per scope (World + the six continents), at
`/quizzes/geography/name-all/:scope/all` (the existing run route, dispatched in
`routes/quizzes/quizzes.$subject.$quizId.tsx` by `quizId === 'name-all'`; `size` is always `all`, which keeps
the saved-run key shape and needs no new route). The count is "x / N" over the scope's ordinary pool
(`poolForQuiz`, the same 197 / continent sets every geography quiz uses — the catalogue's own
sovereignty line, `docs/decisions.md`).

- **Not a `QuizDefinition`.** Like History's fill quiz it has no queue, so it skips the engine
  (`NAME_ALL_QUIZ` in `quizzes.ts` is a plain record: id, title, SEO strings). It is listed after the
  seven quizzes in Geography's list (scope chips, one "N countries" card, best time and history; no
  order toggle, no size ladder) and prerendered per scope (`react-router.config.ts`).
- **Matching** (`matchCountryName`, `names.ts`): forms are the name, official name, every alias and the
  Bulgarian names (`names-bg.ts` — the catalogue has none, so they are a plain table there; it can move
  to `content/` as YAML later). Normalised with `normaliseName`, spaces dropped. Latin letters typed for
  a Cyrillic form go through the history search's Latin-to-Cyrillic regex (`latinToCyrillicRegExp`), as
  in the fill quiz. A form two countries share is dropped, unless it is exactly one country's own name;
  text that could be two countries names none — rejected, never guessed. One typo (a single insert /
  delete / substitute) is forgiven for names of 6+ letters, only when exactly one country is that
  close, never instantly — the one place the "no fuzzy matching" rule is relaxed, because there is no
  prompt to anchor an answer. An exact match is always accepted at once. When a longer still-unnamed name starts with it ("Niger" while Nigeria is open, "Dominica" / "Dominican Republic", "UK" / "Ukraine"; found from the
  list, not hard-coded) the input clears at once, but the text is remembered for **500 ms** (`AUTO_ACCEPT_MS`): a key that
  continues it toward the longer name restores it and carries on; any other key starts fresh. Naming one already named shows "Already named: X", not an error.
- **Timer, desktop**: the run's timer and count are sticky at the top of the panel body (`.quiz-run__clock`),
  so a growing flag list scrolls under them; with the panel collapsed the same timer shows on the stage's
  top-left (`StageClock`, geography runs and Name all). The History fill quiz's head is sticky likewise.
- **Rejected spellings** (`REJECTED_SPELLINGS` in `names-bg.ts`, owner request): "Beliz", "Lao", "Tunis", "Surinam" are never accepted — not as the Latin typing of Белиз / Лаос / Тунис / Суринам, and not through the one-typo allowance (Surinam is one edit from Suriname). The accepted names are Belize, Laos, Tunisia, Suriname; the Cyrillic names still work. Removing an alias is not enough for a spelling like these: the matcher derives Latin-typed Cyrillic matches and typos on its own.
- **Screen** (`features/quizzes/name-all/NameAllQuiz.tsx`): the geography run's chrome. The map stays live, framed on
  the scope (`SCOPE_VIEWS`, `setRegionView`), correct countries in the "mastered" colour via the
  quiz override's `answered` map; names stay hidden (quiz mode). Desktop: START (or Space/Enter) docks
  over the map, the input is always focused (a printable key aimed elsewhere refocuses it), the panel
  holds the timer, `x / N`, Pause / Restart / Give up / Abandon and the named list (flag + name, in
  the order named). Phone: immersive, the shared HUD and input bar ride the keyboard, Give up is a
  text button in the bar, results open the sheet at `full` — no half sheet. Esc pauses, Ctrl+Backspace
  abandons, "Restart" (active run only) is a fresh run with nothing saved. `measureInsets` moved to
  `app/features/quizzes/engine/insets.ts` for it.
- **Results.** On finish: time, "N / N named" and the personal best. On Give up: the score, the missed
  countries in red on the map and as a list (grouped by continent for World, `continentOf`) and the
  named list. Only a **completed** run is saved (`quizId: 'name-all'`, scope, size `all`,
  `firstTryCount = totalCount = N`): `bestQuizTime` is "fastest time", so a quick give-up must never
  count as a best. Runs show as dd.mm.yyyy in the list's history (all quizzes now).
- **Mastery.** No FSRS cards are graded: a free-recall list has no per-country prompt to grade. Saved
  runs are the same `quizRuns` rows as every quiz, so reset, export and import already cover them.

## History: "fill the list"

The first History quiz type, and the first that is not a `QuizDefinition` — there is no queue,
target or map, so it does not use the engine (`app/features/quizzes/engine/engine.ts`). Logic:
`app/features/quizzes/history-fill/fill-quiz.ts` (pure, unit-tested in `app/features/quizzes/history-fill/fill-quiz.test.ts`); screen:
`features/quizzes/history-fill/HistoryFillQuiz.tsx`; run URL: `/quizzes/history/:slug/:quizId` (no scope, no size — a
second route id on the same file, `routes.ts`, which dispatches on the missing `:scope`).

- **Navigation is subject -> country -> quiz.** `/quizzes/history` lists `HISTORY_COUNTRIES`
  (one card each, with its quiz count), `/quizzes/history/:slug` lists that country's quizzes in the
  config's order under Rulers / Governments, and the run is `/quizzes/history/:slug/:quizId`.
  The last two are second route ids on `quizzes.$subject.tsx` / `quizzes.$subject.$quizId.tsx`
  (`routes.ts`), dispatching on the params they lack. The breadcrumb in each panel header links
  one level up; the run's "Back to quizzes" goes to the country's list. The config is keyed by
  country slug (`FILL_QUIZ_CONFIG`), so another country adds its own rows.
- **Quizzes are an explicit table.** `app/features/quizzes/history-fill/fill-quiz-config.ts` has one row per quiz
  (per country slug): `id`, English `title`, `kind` (ruler | government), a `role` regex tested
  against the entry's role, an optional start window (`from` inclusive, `before` exclusive) and an
  optional `toggle`. `fillQuizzesFromRaw(timeline, slug)` applies each row — every selected entry is
  included, no sampling; a row selecting nothing is dropped. Bulgaria has nine: rulers of the
  First (681..1018) and Second (1185..1396) Empire, Princes and Tsars (1878 to before 15.09.1946),
  Heads of state (People's Republic), BKP leaders, Presidents, and Prime ministers for the
  Principality and Kingdom / People's Republic (15.09.1946 to before 10.11.1989) / Republic (from
  10.11.1989) — the three PM windows tile the timeline, a unit test checks no overlap and no gap.
  Entry names are shown in the country's own language (`lang` in `countries.ts`: Bulgarian for Bulgaria, English for the United States; name[lang], the other language if empty); titles are English. Ids are hand-written in the table
  (`bulgaria-rulers-first-empire`, ... — bests are keyed by them, so never rename one). The list
  route's loader and `react-router.config.ts` (prerendered URLs, sitemap) call the same function.
  `Subject.fillQuizzes` marks the subject whose list comes from that loader data rather than
  `Subject.quizzes`.
- **Toggle.** A row may carry `toggle: { label }`; on, the run drops entries whose `elected` is
  false (`elected` is an optional boolean on any history entry in `bg.yaml`, missing = true,
  validated by the build and `check:history`). Shown on the start screen and again on the result
  screen (it applies to the next run; a finished run keeps the setting it was played with, named in
  the result label), hidden — not removed — while a run is going so the grid never jumps. The
  setting is the run's `size`: `"all"` off, `"elected"` on (`toggleSize`), so best times are kept
  separately per setting; the History list shows the toggle-off best. Bulgaria's Presidents has one
  ("Democratically elected only"; off by default): Mladenov and acting Todorov are
  `elected: false` (succession / not chosen by public vote). The label is a field of the config row.
- **United States** (`united-states`, `us.yaml`, added by owner request; periods, presidents,
  50 vice presidents and 298 events): "Presidents of the United States" (all 47 rectangles,
  toggle "Elected to the office only" drops Tyler, Fillmore, A. Johnson, Arthur, Ford) and three
  windows, 1789-1869 (17), 1869-1945 (15), 1945-today (15), which together hold each presidency
  once. Cleveland and Trump are two rectangles each (`pres-cleveland-1/2`, `pres-trump-1/2`):
  the same person, so a typed name fills the earliest unfilled one. Ids of presidents sharing a
  surname carry an initial (`pres-j-adams`, `pres-wh-harrison`, `pres-t-roosevelt`, `pres-bush-sr`)
  and `pres-van-buren` uses the full surname. **Matcher rule:** any form (surname, alias, typed
  spelling) that belongs to entries of two different people is never accepted — "Roosevelt",
  "Bush", "Adams", "Harrison", "Johnson" are rejected, "Teddy Roosevelt" and "Bush Sr" accepted.
  The shared bare surnames are also left out of `us.yaml`'s aliases.
  Vice presidents (kind government, role "Vice President", ids `vp-<surname>`, `-richard/-andrew/-lyndon`
  for the Johnsons): "Vice Presidents of the United States" (all 50; toggle drops Ford and Rockefeller,
  `elected: false`) and windows 1789-1869 (16), 1869-1949 (18), 1949-today (16).
- **Screen.** A centred panel on a plain stage — `.fill-quiz` covers the map/timeline with
  `--flag-stage-bg` like the Flags quiz, but is **not** fixed: it is portalled into the shell's
  `<main class="stage">` (`position: absolute; inset: 0`), i.e. exactly the grid cell between the
  rail and the right panel, so it follows `--rail-width`/`--panel-width` and collapsed state with no
  offsets of its own, and scrolls inside that area; only on a phone is it `fixed` over the whole
  screen. The panel is max 880px, the grid `auto-fill`. One always-focused
  input, the timer/counter in the existing `.quiz-run__timer/__count` look, "Give up", Esc pauses (blurred overlay + Resume, timer frozen) (reveals the
  missing names in red; the run is **not** saved), and a grid of fixed-height rectangles in
  chronological order — dates only until filled, then the name (country's language) in the kind colour (`--sea`
  ruler, `--categorical-violet` government) with a short fill animation. The name is preceded by the
  entry's title (its `role`, parenthetical removed: "цар (малолетен)" -> "цар"; "княз, от 1908 цар"
  as is) only when the quiz's entries carry more than one distinct title (`hasMixedTitles`); typing a
  title is tolerated either way but never needed. Hover/`title` on a filled
  cell shows the exact dates as dd.mm.yyyy. The timer starts at the first keystroke.
- **Read-down layout** (default; a checkbox switches back to row order, not persisted). Tall
  columns first, so the whole list is visible without scrolling: `columnLayout()` in
  `HistoryFillQuiz.tsx` picks 1 column up to 6 entries, 2 up to 12, 3 up to 30, 4 beyond; items run
  top to bottom, then the next column; columns are capped at 340px and left-aligned. Above 30
  entries cells go compact (`fill-quiz__grid--compact`). Phone: 1 column up to 8 entries, else 2,
  and the input bar is `position: sticky` at the top (it wraps: input on its own row, then
  Pause / Give up / Restart). Desktop: years sit in a tinted strip on the cell's left. Phone: the
  cell is stacked — years as a small mono line (12px, tinted) on top, the name below at 15px,
  left-aligned, wrapping, never an ellipsis — so the name has the full cell width; grid is
  `minmax(160px, 1fr)` (two columns, one below ~330px); compact cells (> 30 entries) are ~56px.
  Only the one-phone-column read-down case (`fill-quiz__grid--one`, ≤ 8 entries) keeps the side
  strip, narrower (4.6rem). Thresholds depend on entry count only, so another country's quizzes reuse them.
  On a phone the screen is sized to what the keyboard leaves (`inset: var(--vv-top) 0 var(--kb) 0`
  via `useKeyboard()`), not `100dvh`, so the sticky input stays visible and the last entry scrolls
  clear of the keyboard.
- **Runs** are saved like geography's (`saveQuizRun`, `quizId` = the quiz id, scope `"all"`, size
  `"all"` or `"elected"` — see Toggle), so personal bests, export/import and reset already cover them; the History list shows
  each quiz's best time.
- **Matching** (`normaliseFill` / `matchFill`): lower-case; spaces, hyphens, dots and other
  non-letters ignored; title words хан, княз, цар, khan, prince, tsar stripped; Roman = Arabic
  numerals. Typeable forms of the display name, its other-language twin (name.bg / name.en) and the aliases: (a) a name carrying a number is accepted **only with
  it** — whole, or cut at the numeral ("Симеон I Велики" -> "Симеон 1"); never the bare name, even
  with one such entry left ("Иван Асен" never fills Иван Асен III, "Иван Асен 3" does); (b) a name
  of 2+ words also gives its **surname** (last word, numeral excluded) unless a *different* person in
  the quiz shares it — equal names are the same person (Бойко Борисов x3), and the surname or full
  name fills the earliest unfilled one; ("Батенберг" fills Александър I Батенберг, "Александър"
  doesn't); (c) a first name alone is never a form; a one-word name is its own form. Quirk: for
  "Симеон I Велики" the surname rule makes "Велики" a form. Each alias is one exact accepted
  spelling, exempt from the numeral rule. Latin typed for a Cyrillic name goes through `search.ts`'s
  `latinToCyrillicRegExp`, matched against the whole form. Filled entries are ignored. A wrong
  Enter on a numbered name without its number (`needsNumber`) also shows "Add the number, for
  example II" under the input.
- **Accept** instantly when the text is a valid match and no *other* unfilled entry has a longer form
  starting with it (the target's own longer form doesn't block it);
  otherwise on Enter. A wrong Enter shakes the input and clears nothing — no penalty.
- **One typo** (Levenshtein 1: insert, delete, substitute — a transposition is two) is forgiven for
  names of 6+ letters, **on Enter only** (instant would fire on "Симео"), never across a numeral
  (Борис 3 must not become Борис 2), never for Latin-typed text (a regex, not a string), never when
  the text is itself a name of any entry, and never when it is one edit from two unfilled entries.

## On a phone

Phone layout is documented in CLAUDE.md's "Mobile" section; what a Stage author needs to know:

- A Stage renders `<QuizControls>` (`features/quizzes/engine/QuizControls.tsx`) for the input — never its
  own `<input>` — inside a portalled dock (`createPortal(..., document.body)`), and renders it in
  EVERY phase (idle and done render it hidden) so START can focus it synchronously.
- `QuizStageProps` carries `skip / reveal / canSkip / canReveal` for the phone's Skip and Reveal
  buttons, and `onStart` is the route's `startRun` (focus, then start). Don't wrap it.
- Nothing in a Stage may hard-code a key in copy without an `.only-fine` / `.only-coarse` split.

### Fill quiz: titles, long names, collapsed sidebars
- "президент" is never shown as a title in a rectangle (`isShownTitle`); the "more than one distinct
  title" rule is counted without it. Other titles show on their own small line above the name.
- A rectangle never truncates: `min-height`, the name wraps, a trailing "(…)" goes on its own smaller
  line (`splitNote`), grid column minimum 210px, full text in `title`. No ellipsis.
- **Rule: a quiz screen that covers the background is portalled into `<main class="stage">`**
  (`position: absolute; inset: 0`, padded by `--rail-gap`/`--panel-gap`), never to `<body>`: the
  shell sets `--rail-width`/`--panel-width`/the gaps inline, which `<body>` does not inherit, so a
  body-portalled screen ignores sidebar resizing and collapsing. `.fill-quiz` and
  `.quiz-flag-stage` (Flags) both do this; only a phone makes them `fixed` over the whole screen.
  (The Countries/Capitals dock is a small control over the live map, not a covering screen.)
- Full-area screens in the stage (`.fill-quiz`, `.quiz-flag-stage`, z-index 6) used to cover the
  collapsed sidebars' edge tabs (z-index 5, inside the 0-width rail/panel). Tabs are now z-index 7,
  and the shell sets `--rail-gap` / `--panel-gap` (32px when that side is collapsed) which such
  screens add to their inset. Ctrl+[ / Ctrl+] toggle the sidebars even from inside an input.

## Name the Country from its Outline (`outlines`)

Fourth quiz, grades `geo:<ISO3>:outline`. `features/quizzes/geography/stages/OutlinesStage.tsx` is the flags
quiz's layout (same fixed 460x300 box, `hidesMap`) with a canvas inside, filling the target's
existing `Path2D` (from the coarse payload, which keeps every polygon, islands included)
in `--ink`; no labels, neighbours or sea. The Mercator unit-square path is drawn north-up in the
unwrapped longitude frame (as `topology.ts`), so Russia/Fiji/Kiribati/USA are one shape; a unit
test asserts no bbox spans over 180 degrees. Size: `app/features/countries/outline.ts` —
`box * (area / largestInPool) ^ 0.15`, clamped to 30..100% (`OUTLINE_SIZE_EXPONENT`,
`OUTLINE_MIN_SHARE`); the pool is the run's whole scope pool (before Top-N), so Oceania is not
all at the floor. To give the Stage the world and pool, `QuizStageProps` gained `world` and
`pool` (other Stages ignore them). No `prepare`: nothing to load.


## Phone runs and the keyboard (page lock)

- `useQuizPageLock` (`app/shared/lib/keyboard.ts`) runs for a geography run (while it owns the screen) and for the whole fill quiz: `html.is-quiz-locked` (overflow hidden, `overscroll-behavior: none`, body `position: fixed`, `--chart` background) plus a non-passive `touchmove` guard that cancels any drag outside `.fill-quiz` / `.panel__body` and inside the pause screens (iOS pans the visual viewport on a drag nothing scrolls). Removed on unmount. Phone layout only; desktop untouched.
- `--kb` / `--vv-top` are read once per animation frame and written only when the rounded value changed; React (camera re-frame, canvas redraw) hears about the keyboard 120ms after it stops moving.
- Behind the keyboard only the bar's colour shows: `.quiz-controls` is opaque with a screen-tall `::after` in the same colour (landscape: the same on the bottom HUD); `.fill-quiz` extends under the keyboard and pads its content by `--kb`. No `backdrop-filter` on the run's HUD, bar or pause screens.
- Pause screens (`.quiz-pause`, `.fill-quiz__pause`) are `position: fixed` over exactly what the keyboard leaves, `touch-action: none`, `overscroll-behavior: contain`; buttons still tap.

## History fill quiz on a phone

Same chrome as the geography run (`HistoryFillQuiz.tsx`, phone layout only; desktop markup and behaviour unchanged):

- **HUD** (`.quiz-hud`, portalled to `<body>`, `data-phase="fill-<phase>"` so the landscape bottom-HUD rules don't apply): idle `‹ Back` + entry count; running `‹ Back`, timer, `n / total`, Pause. **Decision:** Restart and Give up don't fit a 360px HUD, so they live on the pause screen (`.quiz-pause`) beside Resume and Abandon run. Finished / given up: only `‹ Back`.
- **Leaving:** `‹ Back` and Abandon run navigate to the quiz list (`sheet: 'full'`) at once and save nothing; only finishing a run saves.
- **Input:** the one `.fill-quiz__bar` is fixed to the bottom, riding on the keyboard, with the page-lock filler under it; its Pause / Restart / Give up buttons are `display: none` on a phone. The "add the number" hint floats just above the bar. The grid scrolls between the HUD and the bar (`.fill-quiz` starts below `--hud-h`, the panel pads past the bar, `--fill-bar-h`).
- **Idle:** the toggles stay at the top of the scrolling area. **Finished:** the result card (`.fill-quiz__summary`: time, count, personal-best message, "A given-up run is not saved.", the toggle for the next run) is at the top of the area, missed cells stay red, and "Try again" / "Back to quizzes" sit in a fixed bottom bar (safe-area aware).

## Map toggles, flags (decisions)

- **Micro** is `Style.micro: 'full' | 'off'` (`microMode()` in `renderer.ts`, falls back to `showPins`). Full = pins and island halos, named beside the pin when Names is on; Off = nothing drawn and nothing hittable (`pick` takes the mode). A quiz run always uses Full, so its target is never hidden. **Names** is `showLabels` (country names only; capital names stay with the Capitals layer, so a ring never loses its name).
- Geography run: `‹ Back` top-left (phone HUD, desktop `.quiz-back-desk`) = Abandon. Flags: `.flag` has no shadow or radius, only a 0.5px alpha-following hairline; the `--flag-shadow-*` / `--flag-stage-shadow` tokens are now unused.

- **Number-optional rulers:** `NUMBER_OPTIONAL_ALIASES` (`fill-quiz-config.ts`, by entry id) adds one exact alias per ruler, like Ferdinand's `aliases` in `bg.yaml`: "Михаил Шишман" (`ruler-mihail-3-shishman`) and "Михаил Асен" (`ruler-mihail-2-asen`). A spelling that belongs to two different people is still rejected.
- **Full-name-only rulers:** `FULL_NAME_ONLY` (`fill-quiz-config.ts`, by entry id) turns off the form cut at the numeral for "Георги I Тертер" and "Георги II Тертер" (`fullNameOnly` on `FillEntry`): "Георги 1" is no longer accepted, only the whole name (owner's request).
