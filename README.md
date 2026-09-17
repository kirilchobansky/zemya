# Zemya

An interactive atlas built for learning, not for looking things up.

The premise: every subject has one natural spatial index, and learning should happen by
navigating that index rather than by flipping cards. Geography's index is the map.
History's is the timeline. Zemya starts with geography and is structured so history can
share the same data model rather than sit beside it as a separate app.

## Status

Pre-alpha, and buildable.

The production app is React 19 + Vite + TypeScript on React Router v8, prerendered to 199
static pages. It does the atlas half — the map, country dossiers, neighbour highlighting,
five choropleth overlays, search, and true-size comparison — plus a first study mode
(nine question kinds over FSRS-scheduled cards). See CLAUDE.md's "Where this is" for the
current state in more detail.

## Repository layout

| Path | What it is |
| --- | --- |
| `content/geography/countries/` | Hand-authored source of truth — one YAML file per country holding its memory hook, flag description, outline description and religion. Editable without touching code. |
| `scripts/` | Build pipeline turning `content/` plus two upstream datasets into shipped JSON. |
| `public/data/geography/` | Generated data, committed deliberately so deploys can't break from an upstream dataset shifting. |
| `app/lib/map/` | The map engine — projection, topology, camera, canvas renderer, interaction. No React in it. |
| `app/routes/` | `atlas.tsx` owns the canvas; the child routes render only the right-hand panel. |
| `prototype/` | The frozen single-file reference build. Self-contained, own `package.json`. |

`content/` is the part of this project with actual value. The canvas renderer can be
rewritten in a weekend; 197 hand-written memory hooks cannot.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

To build the static site exactly as it deploys:

```bash
npm run build      # regenerates public/data, then prerenders 199 pages
npm test           # serves build/client and drives a real browser over it
```

Output lands in `build/client/` — plain files, no server required.

### Editing content

Change a memory hook in `content/geography/countries/<slug>.yaml`, then:

```bash
npm run build:content
```

Commit both the YAML and the regenerated `public/data/geography/*.json` in the same
commit — there is no CI here to catch a drift between them (see CLAUDE.md's Git
conventions).

### The prototype

```bash
cd prototype && npm install && npm run build
```

Open `prototype/dist/zemya-prototype.html`. No server, no network.

## Data provenance

| Data | Source | Licence |
| --- | --- | --- |
| Country polygons | Natural Earth 1:10m via `world-atlas`, unsimplified | Public domain |
| Capitals, currencies, languages, borders, flags | `world-countries` (ISO 3166) | MPL-2.0 |
| Population | 2025 estimates for the ~200 largest states; `country-json` (World Bank 2018) below that | ODbL / see package |
| Religion, flag descriptions, outline descriptions, memory hooks | Hand-authored for this project | see Licensing |

## Licensing

**Undecided, and deliberately so.** No `LICENSE` file means default copyright — all rights
reserved — which is the correct posture for a private repository. Before this repo is made
public, two separate decisions are needed:

- **Code** — MIT is the obvious choice.
- **Content** (`content/`, the authored hooks and descriptions) — this is the moat. It may
  warrant a different licence, or none.

Do not add a `LICENSE` file until both are settled.
