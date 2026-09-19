# Quizzes reference

Look-up material moved out of CLAUDE.md: the route shape, scopes, size ladder, personal
bests, the engine/presenter split, quiz mode, camera-follow and typing capture. Read it
when the task touches `app/lib/quiz/`, `routes/quiz*.tsx`, `components/quiz/` or
`app/lib/geography/quizzes.ts`. Card model and scheduling internals:
[architecture.md](architecture.md).

## Quizzes

The owner's own words on why this exists: "the reason i want this app is the quizzes
actually. Not the detail not anything else." — treat this as the app's core loop, not a
feature alongside the atlas and study mode.

**Route shape.** `/quiz` (`routes/quiz.tsx`) is the catalogue — a list built from
`app/lib/geography/quizzes.ts`'s `QUIZ_DEFINITIONS`/`QUIZ_SIZES`. Every run, of any quiz,
is served by one route: `/quiz/:quizId/:size` (`routes/quiz.$quizId.tsx`), which looks the
id up in `QUIZ_DEFINITIONS` and renders that definition's `Stage`. A second quiz ("Name
the Capital" — since built) is one new `QuizDefinition` entry, never a new route tree or a rewrite
of the catalogue page — this is what let "Name the Flag" arrive as a ~50-line presenter
(`components/quiz/FlagsStage.tsx`) plus a registry entry, reusing everything else. Sizes
come from `app/lib/geography/scopes.ts` (see "Scopes" below), ranked by population within
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

**Camera: follows the player (supersedes "never moves again" below).** START still calls
`atlas.home()` once and the owner likes that. After it, each NEW question runs
`Atlas#followTarget` (`app/lib/map/follow.ts`, pure and unit-tested), which applies the
Interaction-principles rule: (a) target already visible -> **camera untouched**; (b) not
visible -> pan to it **at the player's current zoom**; (c) doesn't fit at that zoom -> zoom
out the **minimum** to fit (`QUIZ_FRAME_PADDING` 0.8 of the visible area), never in, never
to the world view unless fitting needs it. Decided against where the camera is *heading*
(`Atlas#target`), so quick answers chain. Reuses the existing animated `moveTo`, so the
usual zoom/vertical clamps apply. The route calls it from an effect keyed on the target
changing, so a wrong attempt, a pause/resume and a re-render never move the camera.
- **Visible** = all of: fully inside the *visible area* (the canvas minus what covers it),
  clear of the edge by `QUIZ_EDGE_MARGIN_PX` (12), and >= `QUIZ_MIN_TARGET_WIDTH_PX` (24) wide.
  A capital dot (capitals quiz) or a pin-drawn micro-state is a point: it needs
  `QUIZ_POINT_MARGIN_PX` (60) / `QUIZ_PIN_MARGIN_PX` (48) of room and has no size test.
- **What covers the canvas is only the docked quiz input** (`.quiz-dock`, measured by
  `measureInsets()` in the route into a bottom inset). **The brief said the right panel sits
  on top of the canvas; it doesn't** — it is a grid column beside the stage, so a country
  "behind the panel" is simply off the canvas and is treated as not visible for that reason.
  The bottom-left zoomer/scale bar are not modelled (a small corner).
- **The 24 px size test is waived at/below `QUIZ_WORLD_VIEW_FACTOR` (1.25x home).** At the
  world overview nothing is off screen and no pan can make a small country bigger, so
  applying it would slide the world sideways for every small country and throw away the
  still overview the run starts from. It only bites once the player has zoomed in. Constants
  are named, in `follow.ts`; 24 was not tuned beyond a play-through.
- The camera target is the country's **mainland cluster** (`mainlandBox`): largest polygon
  plus any >= 2% of its size within 3 of its diagonals — France without Guiana, Indonesia
  with Papua. (This is the same idea as the `mainBbox` removed earlier, kept to ~30 lines
  and used only here.)
- **A guess returns you to the world view.** When a new target follows an *answer* (correct
  or revealed — `answeredCount` changed) and the player is zoomed in past
  `QUIZ_WORLD_VIEW_FACTOR`, the route calls `Atlas#homeIfZoomedIn()` before `followTarget`.
  A skip is not a guess and keeps the follow rule; a player already at the overview keeps
  their pan. Owner's request after playing the follow-only version.
- The flags quiz (`hidesMap: true`) skips follow and pulse; nothing on screen uses them.

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
second half is superseded by "follows the player" above (pan/zoom-out only when the target
isn't already visible, never zoom in).
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
`/quiz/capitals/:scope/:size` (22 prerendered combinations, from the same ladder). What the
player sees is the countries quiz's screen: the target country in `--brass`, the map at
(roughly) the world view, an input docked at the bottom. `markCapital: true` on the
definition puts `showCapital` on the `QuizOverride`, which `atlas.tsx` turns into the
renderer's `Style.quizPlace` — the target's own capital, drawn as two concentric ink rings
(`drawQuizPlace`) at **any** zoom, because the ordinary capital rings only exist above 6x
and the quiz stays near 1x. Every *other* capital ring, every place label and every place
tooltip stay off under `quizMode`. **The highlight is the question** — nothing on screen
names the country, and nothing names the city until a reveal.
- `match` always returns an outcome (`{ accepted: matchesCapital(...) }`), never `null`,
  because `null` makes the engine fall back to the *country*-name matcher and "France"
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
- `test/smoke.mjs` step 18 is the label-leak test: START on `/quiz/capitals/world/20`, read
  the target from `window.__zemyaQuiz` (now with `targetCapital`), then scan **every text
  node and every `aria-label`/`title`/`alt`/`placeholder`/`value`** — whole-word,
  case- and diacritic-insensitive, `<script>`/`<style>` skipped — for the target's capital
  and country name, before and after answering. It also has a **positive control**: after a
  Ctrl+Enter reveal the same scan must find the capital, or the "not visible" checks prove
  nothing. Typing the country's name must not advance the run (skipped for the handful of
  countries whose capital names include their own).

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
