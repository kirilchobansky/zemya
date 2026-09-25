# Mobile — reference

Moved from CLAUDE.md's "Mobile" section (the rules stay there). Layout by width, input by pointer;
the sheet, tabs, touch map, insets, quiz-on-a-keyboard rules, landscape, gestures, clientLoaders.


Two switches, deliberately independent:

- **LAYOUT follows viewport WIDTH.** `max-width: 819px` (`PHONE_MAX_WIDTH` in
  `app/lib/viewport.ts`, mirrored in `app.css` — change both) is the phone layout. An iPad in
  landscape is the desktop layout. Between 820 and 1000px the rail/panel columns are tighter.
- **INPUT AFFORDANCES follow the POINTER.** `@media (pointer: coarse)` / `isCoarsePointer()`:
  44px touch targets, no hover tooltip, no +/- zoom buttons (pinch exists), no `<kbd>` hints,
  16px input text (iOS zooms the page under that). `.only-fine` / `.only-coarse` swap copy
  ("Click" / "Tap") in CSS, so prerendered HTML never differs by device.

The phone furniture (tab bar, sheet handle, peek content, Layers button, overlay sheets) is in
the DOM at every width and `display: none` above the breakpoint. Do not gate markup on a JS media
query — it would mismatch the prerendered HTML. JS is for behaviour only (`useSheetDrag`, camera
insets), always read at event/effect time.

**The shell.** One viewport tall, `100dvh` (never `vh`); the body never scrolls, only sheet
content (`overscroll-behavior: contain`). The canvas fills the screen behind everything.
Every bottom-pinned thing pads with `env(safe-area-inset-bottom)` (`--tabbar-h` carries it).

**The sheet** is the ordinary `.panel` (`<aside>` in `routes/atlas.tsx`), restyled: 90dvh tall,
parked with `transform: translateY(...)` — snapping animates transform only, never height.
Snaps (`app/lib/sheet.ts`, mirrored in CSS `.panel[data-snap]`), measured from the viewport
bottom: **peek** = tab bar + 88px (handle + the route's `.peek` line), **half** 50%, **full**
90%. The header/handle drag the sheet; inside the scrolling body a drag moves the sheet only when
the body is scrolled to the top (down always, up only below full), otherwise it scrolls. Tap the
handle/arrow to step peek -> half -> full -> half. Snap state lives in `AtlasShell`; a route
asks for one with `state={{ sheet: 'peek' | 'half' }}` (map tap and search pick: peek; tabs:
half). A link that says nothing (a neighbour chip in the sheet) leaves it where it is. **Decision:**
a cold load of anything but `/` opens at half (the page is why they came).
Each panel route's `<header className="panel__head panel__head--peek">` holds a `.peek` block —
what shows at the lowest snap (country: flag + name + capital · population · currency; home:
"Explore the map" + a search prompt; catalogue: "Quizzes"). Routes without one show their
ordinary eyebrow + h2.

**Tab bar:** five buttons, not four — Map · Quizzes · Questions · History plus Progress
(`TabBar`, `MobileChrome.tsx`), kept in lockstep with `app/routes.ts` and `Rail.tsx`'s
`SECTIONS`. Progress stays a data/account overlay sheet rather than a content section — a
judgement call made restructuring the nav into sections, since the prompt didn't say where
Progress goes; confirm before changing. It is not a route: it opens the Progress overlay
sheet (`ProgressSheet`, the same `ProgressSection` + `DataSection` the desktop rail
uses, so Export/Import/Reset stay one implementation). The Layers button (top right) opens
`LayersSheet` (overlay chips + legend from `LayerControls`, the three toggles, Compare size) —
it replaces the desktop toolbar, which is `display: none` on phones. ⌂ is a small floating button
under it; the scale bar is hidden on phones. Icons are inline SVG (glyph characters fall back to
tofu on some fonts).

**Touch map** (`app/lib/map/atlas.ts`): `touch-action: none` on the canvas; one finger pans, two
fingers pinch about their midpoint (the world point that started under the fingers stays under
them, so a two-finger drag also pans). No hover for `pointerType === 'touch'` (no tooltip, no
hover highlight); a tap selects. Hit areas on touch are 24 px radius for capital rings and
micro-state pins (`TOUCH_HIT_RADIUS_PX`) — drawing unchanged. The canvas DPR cap of 2 in
`Atlas#resize` already applies at every width. Phone perf at 4x CPU throttle **missed** the (before gesture snapshots — see below)
target in this sandbox — numbers and cause in `docs/performance.md`.

**Visible map area** (`Insets` in `camera.ts`): whatever covers the canvas is subtracted from
the viewport everywhere the camera frames something — `Atlas#setInsets`, then `frame`,
`homeCamera`, `flyTo`, `fit`, `home` and the clamp all respect it (`Viewport.insets`), and
`followTarget` takes the same insets. On phones the shell sets `{ top: below the search pill,
bottom: what the sheet covers at its snap }`; a full sheet is treated as half (nobody frames a
country in a 10% strip). Desktop has none — the panel is a grid column, not an overlay.

**`position: fixed` inside the sheet is a trap:** a transformed ancestor becomes the containing
block, so anything fixed that a panel route renders (the quiz dock, the flag stage) is
**portalled to `<body>`** (`createPortal` in `MapStage` / `FlagsStage`). Do the same for anything
new.

**Quiz runs on a phone** (`setImmersive` in the atlas context): on a valid run the shell hides the
sheet, tab bar and overlays from START to the results; results open the sheet at `full`
(`setSheetSnap`). The layout is built around the on-screen keyboard, which covers ~40% of the
screen: a thin HUD on top (timer · n / N · pause; `‹ Quizzes` before START), the map (or the
flag) in the middle, the input bar at the bottom pinned directly ABOVE the keyboard
(`.quiz-controls`, `bottom: var(--kb)`). Pause opens a screen with Resume and Abandon. The rules:

- **Keyboard position** comes from `visualViewport` (`app/lib/keyboard.ts`: resize + scroll) and is
  published as `--kb` / `--vv-top` / `--layout-h` / `--kb-est` on `<html>`. The viewport meta also
  says `interactive-widget=resizes-content` (Chrome on Android resizes the layout viewport
  itself) but nothing may rely on it: iOS Safari ignores it, and `visualViewport` is what works.
- **The camera's visible area during a run is the strip between the HUD and the input bar**,
  measured from the DOM (`measureInsets` in `quiz.$quizId.tsx`) and recomputed — with the
  current target followed again, no pulse — whenever the keyboard opens or closes.
- **START focuses the input SYNCHRONOUSLY inside its tap handler** (`startRun`; also "Run it
  again"). iOS opens the keyboard only for focus inside the gesture; an effect or timeout leaves
  it closed. That is why the input is mounted in every phase — `QuizControls` renders it hidden
  (`--idle`, a 1px opacity-0 container) in idle and done — and why `test/smoke.mjs` checks the
  *call stack* of the first `focus()`, not just `activeElement` (Chromium focuses from the effect
  too, so "is it focused" proves nothing).
- **The input's attributes** stop iOS "correcting" answers ("Chad" -> "Chat"): `autocomplete=off
  autocorrect=off autocapitalize=none spellcheck=false inputmode=text enterkeyhint=done`; Enter is
  swallowed (the done key would dismiss the keyboard). The font is 16px (iOS zooms under that).
- **The keyboard stays open for the whole run.** The input is never blurred between questions; the
  canvas never takes focus (`Atlas#setKeepFocus` cancels pointerdown, mousedown and touchstart on
  it — only on a phone layout or coarse pointer; on desktop a canvas click still blurs and the
  typing capture in `engine.ts` recovers, which `test/smoke.mjs` relies on); the Skip / Reveal /
  Pause / Resume / Abandon buttons cancel pointerdown so a tap on them doesn't move focus either.
  The results screen blurs it (the keyboard would cover them).
- **Shortcuts don't exist on a phone**, so real buttons do: Skip and Reveal beside the input
  (48px), Pause in the HUD, Abandon in the pause screen. The Stages take `skip/reveal/canSkip/
  canReveal` for this. On desktop the buttons are `display: none` and `.quiz-controls` /
  `.quiz-dock__row` are `display: contents`, so the desktop layout is untouched.
- **Copy by pointer:** "Tap START" on coarse pointers, "Press START — or Space, or Enter" on fine
  (`.only-coarse` / `.only-fine`); `<kbd>` hints are hidden on coarse pointers. Any new hint that
  names a key needs the same split.
- **Flag quiz:** the flag box is sized ONCE from the strip left with the keyboard OPEN
  (`--layout-h` minus `--kb-est`, the HUD and the bar) and top-anchored, so it never jumps when
  the keyboard opens and never hides behind it; `--kb-est` only grows.

**Landscape phones** get the phone layout, arranged sideways: layout is the phone layout when
`width < 820px` OR `(pointer: coarse) and (height < 500px)` (`PHONE_QUERY`; an iPad in landscape
is still desktop). In landscape the sheet is a right-hand drawer (collapsed 36px tab / 40% / 70% of
the width, same `data-snap` names; `sheetVisible(..., landscape)` in `sheet.ts`), the tab bar is a
slim vertical bar on the left, and the camera's insets subtract both. Map taps and search picks
open the drawer at half (a 36px tab shows nothing). A landscape quiz puts the HUD inline at the
left of the input bar above the keyboard, with the answer chip floating over them; the map gets
the strip above. It is all media queries and read-at-event JS, so rotating needs no reload.

**Rendering & gestures** (`Atlas`): a render is *requested* (`draw()` = one rAF, coalesced),
never issued from an event handler. When a pan, pinch or wheel starts, the last sharp frame is
snapshotted to an offscreen canvas and only that bitmap is drawn (`drawImage` with the gesture's
translate/scale — no path fill or stroke while fingers move); one full sharp render follows 120 ms
after the last event. On coarse pointers a fly-to whose destination is already on screen does the
same; a fly to somewhere the snapshot has no pixels for renders normally. Hover, selection and
hit-testing use the real geometry. Applies to every pointer type, desktop wheel included.

**No click delay:** the country, catalogue, quiz-run and home routes have a `clientLoader` that
answers from the in-memory world (`peekWorld()`; falls back to the server loader / prerendered
`.data` only if the world hasn't loaded), so a tap never waits on `/country/:slug.data`. The
atlas derives the selection from the *pending* navigation location (`useNavigation`), so the
highlight lands on the tap itself.

**Polish** (phone layout, no screen scrolls sideways at 360/390/430 — `test/smoke.mjs` checks the
document, the sheet content and the overlays): the catalogue's region chips are ONE horizontally
scrolling row (the size cards stay three per row, the whole card is the link, the grid keeps its
fixed height — the no-reflow rule); study answers are full-width and >=48px, their 1-4 key badges
hidden on coarse pointers; the dossier's sheet header carries flag, name and capital · population ·
currency, so the body opens with the official name, then the key facts, then hook, progress,
borders and the flag/outline notes (CSS `order` on `.dossier`; the `<h1>` stays, visually hidden).
Neighbour chips wrap. A mostly-sideways swipe is never the sheet's (it is the chip row's).

**Decisions the brief left open** (change them by asking, not by drift):
- Cold load of any page but `/` opens the sheet at half; tabs open Quizzes/Study at half, Map at peek;
  a map tap or a search pick opens at peek. From `full`, the handle steps down to half.
- Progress is an overlay sheet, not a route (no new URL, nothing new in the sitemap).
- The scale bar is hidden on phones; ⌂ sits under the Layers button (and under the HUD in a run).
- Between 820 and 1000px the rail/panel columns are narrower (208/300) so the map keeps room.
- `Atlas#setKeepFocus` applies on phone layouts and coarse pointers only (see the keyboard rules).
- `Viewport.insets` makes the clamp keep the *visible* area inside the map, so the world view centres
  in the visible area rather than behind the sheet.
- DPR is capped at 2 for every device (it already was); the brief's "on coarse pointers" is a subset.

**What Playwright cannot verify:** it emulates the viewport and touch, but not an on-screen keyboard
— it cannot open one or shrink the visual viewport. The keyboard behaviour (the bar riding on it,
the flag fitting above it, the camera re-following, iOS opening the keyboard from START) needs a real
phone; the smoke test covers everything that doesn't need one.

