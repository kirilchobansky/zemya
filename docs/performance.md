# Performance reference

Measured numbers and the LOD design, moved out of CLAUDE.md. The rule and the target stay
there ("## Performance" in CLAUDE.md): 16.7 ms median frame time, full 1:10m detail preserved, and any
change touching `app/lib/map/` runs `npm run perf` and reports the number in the commit.

The owner's own measurements, on their machine, drawing all 197 countries filled and
stroked over the full unsimplified coastline every frame before any of this existed:

| detail | points | frame time | fps |
| --- | --- | --- | --- |
| 0 (full 1:10m) | 463,815 | 74.7 ms | 13 |
| 0.0005 | 161,267 | 37.8 ms | 26 |
| 0.002 | 84,186 | 26.5 ms | 38 |
| 0.006 | 48,603 | 19.0 ms | 53 |

This sandbox's hardware does not reproduce that bottleneck — it already measures
16.7 ms/60 fps at detail 0, before any of the work below — so numbers measured here are
not evidence that a change fixed anything on the owner's machine, only that it didn't
regress here. Report both this sandbox's number and that caveat rather than presenting a
non-reproducing measurement as proof.

**What was built in response** (commits `43396ca`, `3d6ba3e`): (1) cull world copies and
features whose screen-space bbox doesn't intersect the viewport (with margin, so nothing
pops mid-pan) before filling/stroking — pure culling, pixel-identical output; (2) two
geometry payloads, `world.json` (detail 0, full) and `world-coarse.json` (detail 0.006,
~475 KB) — coarse loads first so the map paints fast, full attaches in place in the
background, and the renderer switches per-feature between them at a zoom threshold
(`LOD_ZOOM_FACTOR` in `renderer.ts`). Commit 3 (skip the stroke pass while the camera is
moving, full-quality stroke on release) was scoped but not built: the explicit instruction
was to measure first and skip it if the target was already met, and both commits above
already hit 16.7 ms median on the hardware available to measure with.

**Trap: `npm run build` runs `build:content` first**, which regenerates both geometry
payloads from `content/` and silently overwrites a hand-built test payload (e.g. a
payload edited to test a specific point count or a specific detail level). When measuring
the effect of a specific payload rather than the real content, build with
`npx react-router build` — never `npm run build` — so `build:content` doesn't run first.

## The measuring tool

`npm run perf` (`test/perf.mjs`) checks this: it serves `build/client`, opens a real
browser at 1500x900, waits for the map to paint, then simulates a pan (90 synthetic
`pointermove` events across the canvas) while sampling `requestAnimationFrame` deltas. It
reports time-to-painted-map and median/p95/worst frame time. **Any change touching
`app/lib/map/` runs `npm run perf` and reports the number in the commit message** — "it
feels smoother" is not evidence.

## Next step: content-addressed data URLs (noted, not built)

On Vercel, `/data/*` and `/flags/*` keep the same filename every build, so they can only be
served `must-revalidate` (an immutable cache would serve stale content after a content
update). That costs a conditional round trip per asset on every visit. The real fix:
`scripts/build-content.mjs` emits a build hash, the client fetches `world.json?v=<hash>`
(and the flags likewise), and those responses can then be `immutable` like `/assets/*`.
Not built yet. Revalidation on a warm cache is a 304 with no body, so the cost is latency,
not bandwidth; do it when repeat-visit load time is measured to matter.
