# Zemya — prototype

The original single-file build. **Frozen.** New work happens in the production app at the
repository root; this stays as the reference implementation until every mode here has an
equivalent there, then it gets deleted.

Read it, port from it, don't develop in it.

## Build

```bash
npm install
npm run build
```

Produces two files in `dist/`:

- `zemya-prototype.html` — complete standalone document, opens from disk, works offline
- `zemya-artifact.html` — same content without the document skeleton, for embedding

Both are ~535 KB with everything inlined: map geometry, country data, styles, scripts.

## How it fits together

```
content/*.txt        pipe-delimited authored data, one line per country:
                     ISO3 | religion | flag description | outline description | memory hook

build-data.js        joins the authored text against Natural Earth 1:50m polygons
                     (world-atlas) and ISO country attributes (world-countries),
                     simplifies the topology, re-quantises it to a 32768-step integer
                     grid, and writes world-data.json (~450 KB)

assemble.js          inlines world-data.json + src/* into the two dist/ files

src/ui.html          <title>, fonts, all CSS, all markup
src/geo.js           topology decoding, Mercator projection, per-country geometry,
                     true-size re-projection
src/map.js           canvas renderer, camera, pan/zoom/pinch, hit-testing
src/quiz.js          question generators, distractor selection, matching rounds,
                     route finding
src/app.js           state, panels, modes, scoring, badges, storage
```

Concatenation order matters — `assemble.js` joins the four scripts into one IIFE, so
`geo.js` must come first and `app.js` last.

## Notable implementation details worth carrying forward

- **No map library.** Country polygons are `Path2D` objects in unit-square Mercator space;
  the camera is a single `setTransform`. Hit-testing is `ctx.isPointInPath`, which is exact
  and free. The world is drawn three times (offset −1, 0, +1) so panning wraps seamlessly.
- **Two cameras, clamped independently.** The live camera and the target camera each clamp
  against *their own* zoom level. Clamping the target against the current zoom is what made
  the first version refuse to fly to small countries.
- **Micro-states** (Vatican, Nauru, Monaco, Tuvalu…) collapse to a point at 1:50m, so they
  render and hit-test as pins rather than polygons.
- **Borders come from the ISO dataset, not polygon adjacency.** That is why Spain–Morocco
  is a valid crossing in the route game — the Ceuta and Melilla enclaves are real.
- **True-size comparison** converts each vertex to a ground offset in km from the shape's
  centroid, then re-projects at the target latitude. Ground area is preserved; Mercator
  distortion is not.

## Known gaps the production app must fix

- Mastery is a toy: three correct in a row. Replace with FSRS.
- Progress uses `localStorage` behind a try/catch. Move to IndexedDB.
- No routing — the whole app is one screen with no URLs.
- Population figures mix vintages (2025 estimates for large states, World Bank 2018 below).
- `content/*.txt` is pipe-delimited, which is fragile. Convert to per-country YAML.
