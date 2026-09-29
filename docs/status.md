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
  `scripts/lib/history.mjs`. `category`/`color` read by the hover card; `tags` now read
  by the pinned card's detail view (below).
- Hover on the history timeline: `app/lib/history/renderer.ts`'s `render()` records a
  hoverable region per drawn period/ruler/government capsule and event pin (not the
  period colour wash) and returns them; `app/lib/history/timeline.ts` hit-tests the
  pointer against last frame's regions on pointermove (throttled to one check per
  animation frame, suppressed while dragging or pinch-zooming), brightens the hovered
  capsule/pin on canvas, and reports it up through a `HistoryTimeline` `onHover`
  callback. `app/routes/atlas.tsx` floats `app/components/HistoryCard.tsx` (name, dates,
  role/category/summary per kind — see `app/lib/history/renderer.ts`'s `TimelineEntry`
  for the fields it reads) beside the hovered entry, flipping left/up to stay on screen.
  Suppressed for an entry that already has a pinned card (below).
- Click (or tap) an entry to pin its card on top of the hover card: same content and
  width, draggable (clamped inside the canvas), closable (× or Esc for the front-most),
  up to 8 at once (a 9th closes the oldest). State lives in `atlas.tsx`
  (`pinnedCards`/`selectedHistoryEntryId`), shared with the sidebar through
  `AtlasContext`; cleared on leaving the history route. Pinned entries get a persistent
  1.5px white outline on canvas (`HistoryTimeline.setPinnedIds` → `RenderContext.
  pinnedIds`). A card's "See more" switches the sidebar (`history.bulgaria.tsx`) to a
  plain, unstyled detail view (full summary, tags, dd.mm.yyyy dates) with a Back button —
  see `docs/decisions.md`'s "Pinned cards" for the click-vs-drag and stacking mechanics.
- `scripts/import-rulers.mjs` filled the rest of `content/history/source-bg.html`'s
  ruler/government tables into `bg.yaml` (Second Empire rulers 4.3, Third Kingdom
  monarchs 8.5, governments 7.4/8.6, the three parallel 1946–1989 power tracks from
  9.3) — 765 entries total now. Tier/precision/skip judgement calls not in the source
  are recorded in that script's header comment. `docs/decisions.md` has the reasoning.
- The Bulgaria panel's default view (`history.bulgaria.tsx`, no card's "See more" open):
  header (name, "681 – today", entry count), "Whole history"/"Today" buttons, "Close all
  cards", then `HistoryOutline.tsx`'s vertical list — one row per period (colour swatch,
  Bulgarian name, date range), Възраждане indented under Османско владичество (derived by
  date-containment + tier, not authored — `docs/decisions.md`). Only one section expanded
  at a time; the section containing the timeline's centre date auto-expands as the reader
  pans (`HistoryTimeline`'s `onPeriodChange`, throttled to 5/s), until a manual expand
  overrides it. Expanding shows that period's tier-1 events/rulers, sorted by date. Clicking
  a period/event/ruler row flies the camera to it (`HistoryTimeline.flyTo`, 500ms ease-
  in-out, log-interpolated zoom, cancelled by any drag/wheel/pinch) and pulses a white
  outline on the target for 1.5s after arrival. Same list in the phone bottom sheet, no
  separate layout.
- `/history/bulgaria/list`: a plain, unstyled table of the whole `bg.yaml` dataset
  (year/range, kind, role, name.bg, tier, precision, category, parent), sorted by start
  year then kind — for proofreading the content, not a nav destination. Prerendered (a
  real file for the static host) but `noindex` and left out of the sitemap, and
  deliberately outside `routes/atlas.tsx`'s layout (no canvas, no `AtlasContext`).
  `npm run check:history` reports (read-only, like `npm run audit`) parent/period
  mismatches, >3 same-kind overlaps, future end dates and >5y ruler/government gaps.

