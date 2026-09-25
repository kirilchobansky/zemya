# What works — detail

Moved from CLAUDE.md's "Where this is" (which keeps a summary and the Next list).

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
  exist; Bulgaria ships EUR (an override); Syria's flag is a `content/flags/` override.

- Search and sharing metadata on every page: canonical, Open Graph, Twitter card, per-(quiz, scope,
  size) quiz titles, JSON-LD (`Country` per dossier, `WebSite` on `/`), generated `robots.txt` +
  `sitemap.xml`. The origin is `SITE_URL` = `https://zemya.study` (`.env.example`, or a Vercel env
  var). Indexed on Google. `npm run check:seo` audits `build/client`. `docs/decisions.md`.
- Phone layout (below 820px wide): full-screen map, the right-hand panel as a bottom sheet with
  three snap points, a bottom tab bar, a Layers button, touch pan/pinch, and quiz runs built
  around the on-screen keyboard, landscape drawer. Desktop unchanged. Tested on a real phone by
  the owner and works. See "## Mobile".
- Deployed as static files on Vercel at https://zemya.study (`vercel.json`, `public/404.html`).
- Licensed (MIT code, ODbL data); sources in README, GeoNames credited in the rail footer.
- Four top-level nav sections (Map, Quizzes, Questions, History), one shell: study mode
  renamed Questions (`/questions`, same FSRS engine and store keys; `/study` redirects);
  History picks a country (`/history`, one entry — Bulgaria) and swaps the shell's canvas
  to the timeline at `/history/bulgaria`, now indexed and in the sitemap. `CLAUDE.md`'s
  history exception.
- `content/history/bg.yaml` grew from a 106-entry hand-authored first pass to 680 entries:
  `scripts/import-events.mjs` bulk-imported `content/history/events-bg.json` (613
  auto-generated events), adding a `period-pre` period and two new optional per-entry
  fields, `category` and `tags`, plus `color` (period band / event dot colour, adopted
  from the JSON's era/category colours) — all three now validated and passed through by
  `scripts/lib/history.mjs`. Still data only; no UI reads `category`/`tags`/`color` yet.

