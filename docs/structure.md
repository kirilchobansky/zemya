# Where things live

A guide for a person, not a rule list for tools (the rules, and what the check enforces, are in
[CLAUDE.md](../CLAUDE.md) "Structure"; the full tree is in [architecture.md](architecture.md)).
The idea: the code is grouped by **what part of the product it belongs to**, not by what kind of
file it is. To work on the history timeline you open `app/features/history/` and almost
everything you need is there.

## The folders

**`app/routes/`** — route modules only: the files React Router turns into pages. They are thin
glue: load data at build time, pick components from features, set the page title (the quiz and
questions routes are about 90–150 lines; their screens live in `features/quizzes/pages` and
`features/questions`). `routes/map/atlas.tsx` also carries the shared CSS imports, whose order matters. Grouped by
section (`map/`, `quizzes/`, `history/`, `questions/`). The folders are for tidiness; the actual
URLs are written in `app/routes.ts`.

**`app/features/`** — one folder per part of the product. Each has an `index.ts` listing what
the *other* features may use; everything else in the folder is private to it.
- `map/` — the atlas screen around the map. `components/AtlasShell.tsx` wires four hooks
  (`use-map-controller`: the MapLibre controller, style, selection and camera; `use-history-canvas`:
  the timeline, pinned cards and filters; `use-sidebars`: the desktop rail/panel widths;
  `use-phone-sheet`: the bottom sheet) to small pieces (`AtlasPanel`, `HistoryLayer`, `MapTopHud`,
  `MapBottomHud`, `MapNotices`, `Rail`, `MobileChrome`). Also the shared `AtlasContext` and the
  "Up" button logic.
- `countries/` — everything about countries as data: names and aliases, scopes (continents),
  overlays and colours, mastery per country, the Questions session generator (`questions.ts` is a
  barrel over `question-kinds`, `distractors`, `question-generators`, `session`, `religion`), the
  country search box, the progress ring in the country panel.
- `questions/` — the Questions page (`QuestionsPanel`, `QuestionCard`, `QuestionsResult`,
  `use-question-session`); `routes/questions/questions.tsx` only mounts it.
- `quizzes/` — all quiz types. `engine/` is the shared quiz machinery (`engine.ts` over
  `use-quiz-keyboard`, `use-quiz-timer`, `use-prior-best`, `run-result`); `geography/` has the
  geography quiz definitions and their stages; `name-all/` is "Name all countries" (a container,
  three hooks, and a panel / result / dock / HUD each); `history-fill/` is the history "fill the
  list" quiz (a container, `use-fill-run`, grid, input bar, result, toggle, phone HUD); `pages/`
  holds the quiz list pages and the run page (`QuizRun` with its panel, result and HUD).
- `history/` — the timeline: `timeline/` (the canvas renderer split by job — `render-*` helpers,
  `draw-*` layers, `wire-layout` — and `HistoryTimeline` split into config, model, framing, fonts,
  hover, gestures, fly animation, period reporter and frame scheduler), `data/` (history
  countries, search, the build-time catalog), `components/` (hover card, detail, filters,
  outline, search).
- `progress/` — the learning store: what you've answered, when a card is due. It knows nothing
  about countries; card ids are just strings to it.

**`app/engines/map/`** — the map renderer (MapLibre) and the camera maths. Plain TypeScript, no
React, no knowledge of the rest of the app; the app talks to it through `MapController`. `gl-atlas.ts`
is the thin `GlAtlas` facade; map creation (`gl-setup`), camera (`gl-camera`), hover and picking
(`gl-hover`, `gl-picking`), the comparison outline (`gl-compare`), feature state (`gl-styling`) and
per-camera labels (`gl-view-sync`) are separate modules it composes.

**`app/shared/`** — small things any part of the app can use and that know nothing about any
feature: `components/` (the flag image), `layout/` (bottom-sheet and viewport helpers), `lib/`
(formatting, keyboard, SEO, theme), `styles/` (design tokens, the base reset, and the small
stylesheets several features share — see "CSS" below).

**`content/`** — the hand-written data (YAML). **`public/data/`** — what the build generates from
it; committed.

**`scripts/`** — Node scripts, never shipped. `build/` generates data and images, `import/` are
one-off importers, `audit/` are read-only reports and QA checks, `lib/` is shared helpers.
`check-structure.mjs` runs the structure check (`npm run check`).

**`tests/e2e/`** — browser tests against the production build (`npm test`, `npm run perf`).
Unit tests are **not** here: they sit next to the code (`scale.ts` has `scale.test.ts`).

## Where do I put X?

| I'm adding… | It goes in |
| --- | --- |
| a new page / URL | a route module in `app/routes/<section>/`, plus a line in `app/routes.ts` |
| a hook (state + effects for a screen) | `use-xxx.ts` next to the component that uses it; a screen over ~150 lines gets a container component plus a hook plus one file per piece of UI |
| a component used by one feature | that feature's folder (`features/<name>/components/` or next to its siblings) |
| a component used by several features and knowing nothing about any | `app/shared/components/` |
| a new quiz | `features/quizzes/<kind>/` — a `QuizDefinition` plus its id in `QUIZ_IDS` (see [quizzes.md](quizzes.md)) |
| something about a country's data (names, scopes, mastery) | `features/countries/` |
| something about the timeline | `features/history/` (drawing -> `timeline/`, data -> `data/`, UI -> `components/`) |
| scheduling / saved progress | `features/progress/` |
| map drawing, projection, camera | `app/engines/map/` |
| a formatting / keyboard / theme helper | `app/shared/lib/` |
| layout helpers (sheet, viewport) | `app/shared/layout/` |
| colours, theme tokens | `app/shared/styles/tokens.css` |
| styles for one component | `Component.css` next to it, imported by it |
| styles for a page / a feature's screens | a named `.css` in the feature folder (or beside the route) |
| styles several features use | a small `.css` in `app/shared/styles/` named by purpose, imported in `routes/map/atlas.tsx` (mind the order) |
| a unit test | next to the file it tests, `name.test.ts` |
| a browser test | `tests/e2e/` |
| a script that generates data | `scripts/build/` |
| a Node helper used by scripts | `scripts/lib/` |
| hand-written content | `content/` |
| a new top-level folder | don't — record the reason in [decisions.md](decisions.md) first |

## Dependency rules

Arrows mean "may import". Anything not listed is not allowed.

```
routes  -> features (through index.ts), engines, shared
features -> engines, shared, other features (through their index.ts only)
engines -> nothing in the app (and no React)
shared  -> nothing in features, engines or routes
features/progress -> never features/countries
```

- Reach into another feature through `~/features/<name>`, never into its folders. If you need
  something that isn't exported, add it to that feature's `index.ts` — that is a decision to
  make on purpose. (Exception: `*.server.ts` files, which can't be re-exported to the browser;
  and unit tests that mock a module.)
- Inside one folder use `./thing`; across folders use the aliases `~/features/...`,
  `~/shared/...`, `~/engines/...`.
- Two features must not import each other in a circle. If they want to, one of them is doing the
  other's job — move the shared piece down into the one that owns it.

## File rules

- A source file stays under **400 lines** (aim for 300). Split by purpose: state and effects into a
  `use-xxx.ts` hook, logic into small plain modules, each piece of UI into its own component file,
  constants and types into their own file. Keep the exports other files use unchanged, and put
  anything another feature needs in the feature's `index.ts`. `npm run check` fails above that;
  its short temporary allow-list names the files still to be split, and only ever shrinks.
- **One component per file**, named after it: `HistoryCard.tsx` holds `HistoryCard`. A
  component's tiny private helpers can stay in its file.
- Names: components `PascalCase.tsx`; everything else `kebab-case.ts`; hooks start with `use`;
  route modules keep React Router's dotted names (`quizzes.$subject.tsx`). A few older
  camelCase names (`quizSeo.ts`) stay until the file is next touched.
- Tests next to code, same name plus `.test.ts`.

`npm run check` runs both the line limit and the import rules; `npm test` runs it first.

## CSS

There is no big stylesheet. Every rule lives in a small file with the thing it styles, and the
file is imported by that thing.

- **Per component:** `HistoryCard.css` sits beside `HistoryCard.tsx`, which imports it. A
  component's phone rules stay in its file; if the file would pass 300 lines it splits by purpose
  (`HistoryFillQuiz.phone.css`, `HistoryFillQuiz.grid.css`), never in the middle of a rule.
- **Per page or feature:** a screen's styles go in the feature folder (`quizzes/engine/quiz-run.css`,
  `quiz-list.css`) or beside its route (`routes/map/atlas.css`). Whoever renders the screen imports
  it.
- **Shared:** a class used by several features lives in `app/shared/styles/`, in a small file
  named by purpose: `layout.css` (shell and sidebars), `panels.css`, `sheet.css`, `buttons.css`,
  `content.css`, `progress.css`, `dossier.css`, `empty.css`, `subject-list.css`, `phone.css`
  (furniture hidden on desktop, phone variables), `pointer.css` (touch-sized targets).
- **Global:** only `tokens.css` and `base.css` (reset, body, element defaults). `root.tsx` imports
  them, plus `empty.css` and `buttons.css` because its error screen uses `.empty` and `.action`.
- Do not rename classes or "tidy" selectors while moving them: the point of the split is that
  nothing visual changes.

**The cascade is part of the structure.** CSS applies by specificity, then by *order*, and order
now depends on which file is loaded first. The map shell loads first (its stylesheets are imported
at the top of `routes/map/atlas.tsx`, in an order that matters), then each section's chunk, so a
shared file can safely be overridden by a feature file but not the other way round. Rules for
this:

1. A rule that overrides another rule of equal specificity must be in the same file, or in a file
   that loads later. Shared files load before feature files; inside `atlas.tsx` the shared imports
   keep their order (`phone`, `layout`, ... `pointer` last).
2. A feature file may therefore not hold a rule that has to come *before* a shared rule on the
   same element. That is why one `HistoryFillQuiz` phone rule (`.fill-quiz__giveup, .fill-quiz__restart`)
   sits in `phone.css`: `pointer.css` (shared, loaded with the shell) must stay after it.
3. Before moving a rule, ask whether another rule can hit the same element and set the same
   property. If so, keep their order (same file, or the earlier one in an earlier-loading file).
4. If you add a shared stylesheet, import it in `atlas.tsx` at the right place, and check the built
   CSS: `npm run build` and look at the per-route CSS list in `build/client/assets/manifest-*.js`.

Phase 2 of the restructure moved the old `app.css` into these files with a throwaway script that
checked the built CSS before and after (same rule set; same relative order of every pair of rules
that can hit one element, on every page and every navigation order).

## What the big files became (phase 3A)

Every file that was on the line-limit allow-list under `app/` was split by purpose; the exports other files use are unchanged.

- countries/questions.ts -> question-kinds.ts, religion.ts, distractors.ts, question-generators.ts, session.ts; questions.ts is now a re-export barrel (names.ts imports religion.ts)
- quizzes/engine/engine.ts -> engine-types.ts (QuizEngine, constants, resolveMatch), use-quiz-timer.ts, use-quiz-keyboard.ts (+inputKeyDownHandler), use-prior-best.ts, run-result.ts; engine.ts keeps useQuizEngine + REVEAL_FILL_MS
- history/timeline/timeline.ts -> timeline-config.ts, timeline-model.ts, timeline-framing.ts, timeline-fonts.ts, timeline-hover.ts, timeline-gestures.ts, fly-animation.ts, period-reporter.ts, frame-scheduler.ts; timeline.ts keeps HistoryTimeline (re-exports flyTargetFor/types)
- history/timeline/renderer.ts -> render-types/colors/easing/geometry.ts, draw-background/ticks/wires/pins/connectors/centre.ts, wire-layout.ts (tool-split by declaration); renderer.ts = render()+renderAt() entry, re-exports public names
- engines/map/gl-atlas.ts -> gl-setup.ts (map creation), gl-host.ts (collaborator view), gl-camera.ts, gl-hover.ts, gl-picking.ts, gl-compare.ts, gl-styling.ts (feature state/paint), gl-view-sync.ts (labels/capitals/pins per camera); gl-atlas.ts = GlAtlas facade (create/destroy/delegation/resize/pulse)
- quizzes/history-fill/HistoryFillQuiz.tsx -> use-fill-run.ts (state/effects), fill-run-types.ts, FillGrid, FillInputBar, FillResult (card+buttons), FillToggle, FillPhoneHud; HistoryFillQuiz = container (CSS imports stay there)
- quizzes/name-all/NameAllQuiz.tsx -> use-name-all-world/run/atlas.ts, name-all-types.ts, NameAllPanel, NameAllResult, NameAllNamedList, NameAllFlag, NameAllDock, NameAllHud (+ engine/PauseIcon.tsx shared with FillPhoneHud); NameAllQuiz = container
- routes/map/atlas.tsx -> thin route (CSS imports + ProgressProvider + AtlasShell); features/map: components/AtlasShell, AtlasPanel, HistoryLayer, MapTopHud, MapBottomHud, MapNotices; hooks/use-map-controller, use-history-canvas, use-sidebars, use-phone-sheet; sidebar-storage.ts, micro.ts
- routes/quizzes/quizzes.$subject.tsx -> features/quizzes/pages/{QuizList,QuizListItem,QuizHistoryPanel,HistoryCountries,HistoryCountryQuizzes,QuizNotFound,use-quiz-list,quiz-list-data}; route keeps loader/clientLoader/meta + dispatch (89 lines)
- routes/quizzes/quizzes.$subject.$quizId.tsx -> features/quizzes/pages/{QuizRun,QuizRunPanel,QuizRunResult,QuizRunHud,use-quiz-run-data,use-quiz-atlas-bridge,use-quiz-test-seams}; route keeps loader/clientLoader/meta + dispatch (155 lines)
- geography/quizzes.test.ts -> quizzes.test.ts (selection/scopes), quiz-overlay.test.ts, quiz-definitions.test.ts; history-fill/fill-quiz.test.ts -> fill-quiz.test.ts (matching), fill-quiz-tables.test.ts (shipped timelines). 399 tests unchanged.
- routes/questions/questions.tsx -> features/questions/{QuestionsPanel,QuestionCard,QuestionsResult,QuestionsMessage,use-question-session,questions.css,index.ts}; route = meta + <QuestionsPanel/> (new feature, one public export)
