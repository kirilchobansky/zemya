# Zemya

An interactive atlas built for learning, not for looking things up.

The premise: every subject has one natural spatial index, and learning should happen by
navigating that index rather than by flipping cards. Geography's index is the map.
History's is the timeline. Zemya starts with geography and is structured so history can
share the same data model rather than sit beside it as a separate app.

## Status

Pre-alpha. The repository currently holds a working single-file prototype under
[`prototype/`](./prototype) — 196 sovereign states with real Natural Earth polygons,
hand-written memory hooks, and nine study modes. It runs offline from one HTML file.

The production app (React + Vite + TypeScript, deployed as a static site) is being built
alongside it. The prototype stays in the repo, frozen, as the reference implementation
until every one of its modes has an equivalent.

## Repository layout

| Path | What it is |
| --- | --- |
| `prototype/` | The frozen single-file reference build. Self-contained, own `package.json`. |
| `content/` | Hand-authored source of truth — the memory hooks, flag and outline descriptions. Plain text, editable without touching code. |
| `src/` | The production app. |
| `scripts/` | Build pipeline turning `content/` into shipped data assets. |
| `static/data/` | Generated data, committed deliberately so deploys can't break from an upstream dataset shifting. |

`content/` is the part of this project with actual value. The canvas renderer can be
rewritten in a weekend; 196 hand-written memory hooks cannot.

## Running the prototype

```bash
cd prototype
npm install
npm run build      # fetches map data, generates dist/zemya-prototype.html
```

Open `prototype/dist/zemya-prototype.html` in any browser. No server, no network.

## Data provenance

| Data | Source | Licence |
| --- | --- | --- |
| Country polygons | Natural Earth 1:50m via `world-atlas` | Public domain |
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
