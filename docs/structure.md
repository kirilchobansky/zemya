# Where things live

A guide for a person, not a rule list for tools (the rules, and what the check enforces, are in
[CLAUDE.md](../CLAUDE.md) "Structure"; the full tree is in [architecture.md](architecture.md)).
The idea: the code is grouped by **what part of the product it belongs to**, not by what kind of
file it is. To work on the history timeline you open `app/features/history/` and almost
everything you need is there.

## The folders

**`app/routes/`** — route modules only: the files React Router turns into pages. They are thin
glue: load data at build time, pick components from features, set the page title. Grouped by
section (`map/`, `quizzes/`, `history/`, `questions/`). The folders are for tidiness; the actual
URLs are written in `app/routes.ts`.

**`app/features/`** — one folder per part of the product. Each has an `index.ts` listing what
the *other* features may use; everything else in the folder is private to it.
- `map/` — the atlas screen around the map: the side rail, the mobile chrome, the shared
  `AtlasContext`, and the "Up" button logic.
- `countries/` — everything about countries as data: names and aliases, scopes (continents),
  overlays and colours, mastery per country, the Questions session generator, the country
  search box, the progress ring in the country panel.
- `quizzes/` — all quiz types. `engine/` is the shared quiz machinery; `geography/` has the
  geography quiz definitions and their stages; `name-all/` is "Name all countries";
  `history-fill/` is the history "fill the list" quiz.
- `history/` — the timeline: `timeline/` (canvas drawing and time maths), `data/` (history
  countries, search, the build-time catalog), `components/` (hover card, detail, filters, outline, search).
- `progress/` — the learning store: what you've answered, when a card is due. It knows nothing
  about countries; card ids are just strings to it.

**`app/engines/map/`** — the map renderer (MapLibre) and the camera maths. Plain TypeScript, no
React, no knowledge of the rest of the app; the app talks to it through `MapController`.

**`app/shared/`** — small things any part of the app can use and that know nothing about any
feature: `components/` (the flag image), `layout/` (bottom-sheet and viewport helpers), `lib/`
(formatting, keyboard, SEO, theme), `styles/` (design tokens and the stylesheet).

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

- A source file stays under **400 lines** (aim for 300). `npm run check` fails above that;
  its short temporary allow-list names the files still to be split, and only ever shrinks.
- **One component per file**, named after it: `HistoryCard.tsx` holds `HistoryCard`. A
  component's tiny private helpers can stay in its file.
- Names: components `PascalCase.tsx`; everything else `kebab-case.ts`; hooks start with `use`;
  route modules keep React Router's dotted names (`quizzes.$subject.tsx`). A few older
  camelCase names (`quizSeo.ts`) stay until the file is next touched.
- Tests next to code, same name plus `.test.ts`.

`npm run check` runs both the line limit and the import rules; `npm test` runs it first.
