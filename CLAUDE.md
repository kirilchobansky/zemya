# Zemya — working instructions

Read this before touching anything: it carries what always applies. Feature narrative,
rationale and full detail live in `docs/` — read the file for the area you're touching:
[architecture.md](docs/architecture.md), [quizzes.md](docs/quizzes.md),
[performance.md](docs/performance.md), [decisions.md](docs/decisions.md),
[mobile.md](docs/mobile.md), [status.md](docs/status.md). An interactive atlas for learning
geography (later: history) — every subject has a natural spatial index and you learn by
navigating it (geography: the map; history: the timeline), sharing one data model. Owner:
Kiril (@kirilchobansky). Solo project. Bulgarian; "Zemya" = Земя, earth.

## Where this is

The map is MapLibre GL over our own PMTiles (`docs/architecture.md`); the canvas renderer is gone.
Four top-level sections — Map, Quizzes, Questions, History — share one shell
(`routes/atlas.tsx`): the atlas, Questions (FSRS session, formerly "Study"), seven quizzes on
one engine (Countries, Flags, Outlines, Capitals, Currency, Language, Religion — the last three have non-unique answers, `docs/quizzes.md`), a Bulgaria and a United States (`united-states`, `content/history/us.yaml`: 12 periods + 47 presidencies + 50 vice presidents (kind government) + 298 events, eight fill quizzes) history timeline (`/history/:slug`, two countries today,
canvas-only — see "Do not") plus one History quiz type, "fill the list" (Quizzes -> History: nine quizzes listed in an explicit table (`app/lib/history/fill-quiz-config.ts`, e.g. "Presidents",
"Prime ministers, Republic"), each selected from the timeline by role and start date,
`/quizzes/history` -> country -> `/quizzes/history/:slug/:quizId`; `docs/quizzes.md`). Island nations (no land border, under 25,000 km2, minus the Caribbean/Malta/Cyprus/Bahrain — 17, derived) draw a territory halo instead of a pin: `docs/decisions.md`. Deployed on Vercel at https://zemya.study, indexed, MIT code /
ODbL data. Full current-state list: `docs/status.md`; narrative and "Next" items: `docs/decisions.md`.

## Locked decisions and editorial lines — do not reopen without asking

Web, PWA-installable; React 19 + Vite 8 + TS + React Router v8, framework mode (every route
loader runs at **build time**); Vercel static hosting, Hobby tier (no commercial use); no
backend; IndexedDB via Dexie, local-first; ts-fsrs scheduling; map = MapLibre GL JS (WebGL, Web Mercator) over our own
PMTiles cut at build time — owner's decision, replaced the custom canvas engine (`docs/decisions.md`),
coastlines 1:10m unsimplified in the top tile level; repo public. 197 countries (193 UN members
+ Vatican City + Palestine + Taiwan + Kosovo — an editorial recognition line, not a fact);
absorbed territories merge into a real country at build time via `ABSORB` in
`scripts/build-content.mjs`, never a special case in `topology.ts`. Reasoning: `docs/decisions.md`.

## Structure — rules that follow from the layout (full tree: `docs/architecture.md`)

- `content/` stays editable by a non-programmer (plain YAML/text, no code, no build step);
  generated data is **committed**, not built at deploy time. `app/lib/map/` must not import
  React or anything from `app/lib/geography/`; `app/lib/core/` must not import from
  `app/lib/geography/` or anything geography-specific — card ids are opaque strings to it.
  Anything reading `public/data/*.json` lives in a `*.server.ts` file, stripped from client.
- New library code lives under `app/lib/` (`core/`, `map/`, `geography/`, `history/`), never
  a top-level sibling like `app/history/` — record any further placement decision like this
  in `docs/decisions.md`. The camera moves only when the user could not already see the
  target (click vs. fly-to, quiz follow) — full contract: `docs/architecture.md`.
- **Places/capitals** (`docs/architecture.md`): no non-capital cities without a decision;
  one predicate, `capitalsVisible()`, gates rings/labels/hit-testing, off under `quizMode`.
  **Cards**: one per (country, facet), lazy, mastery derived never stored; **every table the
  app writes must be covered by reset, export and import**, same commit. **Quizzes**
  (`docs/quizzes.md`): one engine, one route behind a subject picker; a new quiz is a
  `QuizDefinition` plus its id in `QUIZ_IDS`; anything showing a country's name is gated on
  `quiz`/`quizMode`; no Stage moves when its content changes size; never `disabled` the run
  input. Run keys: Esc pause, Tab skip, Ctrl+Enter reveal, Enter (after a reveal) fills in the
  answer, Ctrl+Backspace abandon; "Restart" (active run only) = a fresh run, nothing saved.
- **Map** (`docs/architecture.md` "Map renderer"): the rest of the app talks to `MapController`
  (`app/lib/map/controller.ts`), never to MapLibre. `maplibre-gl` is imported ONLY by
  `app/lib/map/gl-atlas.ts`, reached only through `engine.ts`'s dynamic import (first load stays
  small, prerender never evaluates it). Per-country colour and emphasis are **feature state**,
  never rebuilt geometry. Shapes come from `public/data/geography/world.pmtiles`
  (`scripts/build-tiles.mjs`, run by `build:content`, committed). Camera maths (`camera.ts`,
  `follow.ts`) is unchanged; MapLibre only draws and moves.
- **Mobile** (`docs/mobile.md`): layout follows viewport width, affordances follow the
  pointer — never gate markup on a JS media query; one `100dvh` shell; `position: fixed`
  inside the bottom sheet must be portalled to `<body>`. **Visual identity**
  (`docs/decisions.md`): `tokens.css` is the single source of truth for theming; map
  colours resolve once via `getComputedStyle`, re-read only on a theme change, never per
  frame; any colour change is checked in both themes against WCAG AA.

## Commands

```bash
npm install
npm run dev             # dev server on :5173
npm run build           # build:content, then prerender every static page
npm run build:content   # content/ -> public/data/
npm run typecheck       # react-router typegen && tsc --noEmit
npm test                # serves build/client and drives a real browser
npm run test:unit       # vitest — pure-logic tests, no browser
npm run check:seo       # audits build/client: sitemap, titles, canonical, JSON-LD
npm run audit           # stale-data report. Read-only. RUN BEFORE ANY RELEASE
npm run audit:flags     # rasterises every flag against its authored description
npm run check:history    # history content QA report (parent bounds, overlaps, gaps). Read-only
npm run build:tiles     # world.json -> world.pmtiles (also part of build:content)
npm run perf            # STALE: measured the removed canvas renderer — rewrite before use
```

Performance target: 16.7 ms median frame at world zoom, full detail, no low-res frames while moving (WebGL; `docs/performance.md`).

## Git conventions

Solo project, one machine, one person. No branches, no pull requests, no CI.

- Work directly on `main`. Commit when a change works, small commits fine; subject
  imperative, lower case, no trailing period.
- **Default verification:** `npm run typecheck`, `npm run test:unit`, `npx react-router
  build`. `npm test` (needs `npm run build` first; `CHROMIUM_PATH=/opt/pw-browsers/chromium`
  here), screenshots and `npm run perf` run ONLY when a prompt explicitly asks. Run `npm run
  build:content` too when content changed, committing the regenerated `public/data` with it.
- This sandbox can read the repo but not push. Leave commits unpushed; the owner clicks
  Sync in VS Code — a push failing here is expected, not an error to chase.
- Record any decision the prompt did not specify — a name, a data shape, a trade-off, a
  deviation — in CLAUDE.md (or the matching `docs/` file) in the same commit; one that lives
  only in a commit message or chat reply gets relitigated. Update "## Where this is" (and
  `docs/status.md`) in every commit that changes what works.

## Content conventions

Memory hooks are one sentence, concrete, surprising — not encyclopaedia summaries, written
as fragments with an implied subject (any surface showing one elsewhere must supply it).
Flag descriptions describe geometry/colour; outline descriptions describe silhouette. Quiz
only on falsifiable facts: dates, places, actors, sequence — never causation. A new
dataset's licence is checked and recorded in README before use. Overrides (name/flag/
capital/alias) close upstream data gaps only, each hand-curated YAML with a mandatory
`note` — never assert an opinion; a disputed fact is marked `disputed:` with a reason and
never quizzed. `npm run audit` reports staleness against a second dataset + a watchlist but
changes nothing — a human fixes each case. Mechanism, current list and examples:
`docs/decisions.md`.

## Do not

- Do not add subjects beyond geography until geography ships and has users, beyond the
  owner-requested History exceptions already built (History quizzes: "fill the list" only, listed in `fill-quiz-config.ts`, selected from the timeline — `app/lib/history/fill-quiz.ts`, `components/HistoryFillQuiz.tsx`, `/quizzes/history/:slug/:quizId`; `content/history/*.yaml` +
  its build, `app/lib/history/*`, `/history` + `/history/:slug` as a nav section, and a
  "History timeline" link in the country dossier for any `HISTORY_COUNTRIES` slug) — no
  other quiz type or further logic/UI there without asking again. Full narrative and exact file list:
  `docs/decisions.md`.
- **How to add a history country** (the History section is data-driven; Bulgaria is the only
  one so far): add `content/history/<file>.yaml`, run `npm run build:content` (writes
  `public/data/history/<file>.json`, commit it), add one entry to `HISTORY_COUNTRIES` in
  `app/lib/history/countries.ts` (slug, file, names, startYear, range, pastLabel,
  futureLabel). Each country has a display language (`lang: 'bg' | 'en'` in `countries.ts`):
  data in that language is required (name and blurb non-empty), the other is optional;
  `pastLabel` is a full string with a `{year}` placeholder. Bulgaria is `bg`, every other
  country `en` (English role, e.g. `president`; Cyrillic spellings go in `aliases`, typing only). Routes, prerender, sitemap, dossier link, `build-history` and `check-history`
  pick it up with no code change.
- Do not add accounts, a database, or any server call in the first release; a map tile
  provider or API key; or secrets in the repo (`.env` is gitignored, `.env.example`
  committed). Do not use `localStorage` as the primary store — IndexedDB, guarded fallback,
  one exception: the theme choice (must be read synchronously before first paint).
- Do not hand-write bulk historical content later (seed from Wikidata, hooks only by hand);
  do not change a country's `slug` once shipped — it is a public URL; do not enable lazy
  route discovery (a static host has no `/__manifest` endpoint); do not load flags from a
  CDN (local, offline-capable, no third party sees usage).
- Do not re-introduce coastline simplification, or add a Shapefile dependency/build-time
  fetch for the remaining lakes (Great Lakes, Victoria, Baikal), without asking first.
