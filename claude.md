# loclocloc — agent context

London-focused **Vite + React + Leaflet** explorer: postcode pins, toggleable POI layers, LSOA choropleths, blended scorecards, optional walk rings and TfL journey isochrones. Static **GeoJSON** in `public/data/`; no backend.

**Live:** https://loclocloc.netlify.app  
**Repo:** https://github.com/12ian34/loclocloc

This file is **safe for a public repo** — no secrets. API keys live only in local `.env` or host env (gitignored / dashboard).

---

## Stack & entrypoints

| Area | Location |
|------|----------|
| UI / map | `src/App.jsx` (large single file: layers, scoring, sidebar, modals) |
| Styles | `src/App.css` (includes mobile drawer, data modal, sidebar footer) |
| Data copy (modal) | `src/dataSources.js` — `BUILD_DATE` from Vite `define` |
| Boot | `src/main.jsx`, `index.html` |
| Build | `vite.config.js` — `__BUILD_DATE__` injected at build time |
| Lint | `eslint.config.js` — browser globals + `__BUILD_DATE__` |

---

## URL / state

- App state is synced to **`window.location.hash`** (query-style params): postcodes `p`, layers `l`, choropleth `c`, opacity `o`, walk rings `r`, filters `f` (JSON).
- Helpers: `encodeAppState` / `decodeAppState` in `App.jsx`.
- **Copy share link** in sidebar copies full `href` (includes hash).

---

## Layers (IDs matter for URL + scoring)

**POIs** — `POINT_LAYERS`: each `{ id, name, file, color, emoji }`. Fetched on load into `layerData`.

**Choropleths** — `CHOROPLETH_LAYERS`: each `{ id, name, file, property, emoji, unit, colorStops, format, inverse }`. Multiple entries can share one **file** (e.g. IMD domains); loader dedupes by `file` and fills `choroplethData[id]` per layer id.

**Notable choropleth ids**

- `crime-current`, `air`, `imd`, `imd-*` domains, **`rent-est`** (`/data/rent.geojson` — **modelled** rent from `scrapers/rent.js`, not official listings).
- Re-clicking the active choropleth row clears it (`onMouseDown` + `toggleChoropleth`).

**Defaults** — no POI layers on; no choropleth; Filter Areas section expanded; POI / Area sections collapsible.

---

## Scoring (`computePostcodeScores`)

- **Area** (`SCORE_AREA_DIMS`): LSOA from point-in-polygon (or nearest centroid); percentile of raw value in London distribution; score = `round(100 - percentile)` so **lower raw = better** for crime, pollution, deprivation, **and lower £ rent = better** for `rent-est`.
- **Proximity** (`SCORE_PROX_DIMS`): density-weighted distance sum vs `cap`; some dims use `inverse` (e.g. betting).
- **Overall**: mean of enabled area + proximity scores.
- Users can disable dimensions on the scorecard (`disabledScoreDims`).

---

## Filters

- `FilterPanel` sliders: `crime-current`, `air`, **`rent-est`**, `imd` — keep LSOAs passing **all** active thresholds (`filterPassSet` by `code`).
- Filter-only green/grey overlay uses IMD or crime geometry as reference when no choropleth is active.

---

## Optional TfL

- `VITE_TFL_API_KEY` — read in client as `import.meta.env.VITE_TFL_API_KEY`. If empty, transit isochrones still UI-visible but API calls won’t authenticate.
- **Do not** document key setup in README (project choice); hosts inject at **build** time for production.

---

## Scrapers & data

- **`scrapers/*.js`** — regenerate `public/data/*.geojson` (and caches `_lsoa-boundaries.geojson`, `_imd_scores.xlsx`). Full procedure and source attribution: **`README.md`** sections **Updating bundled data** and **Data sources**.
- **`scrapers/lib/boundaries.js`** — ONS ArcGIS LSOA 2021 for London; shared by IMD, crime, air, rent, etc.
- **`scrapers/rent.js`** — outputs **`rent.geojson`**; IMD 2011 codes mapped / imputed to 2021 LSOAs; borough anchor table inside file.

---

## Deploy (Netlify)

- Build: `npm run build`, publish **`dist`** (see `netlify.toml`).
- Client bundle includes any `VITE_*` present at build time.

---

## UX extras

- Sidebar footer: **Copy share link**, **Data & freshness** modal (`DataAboutModal` + `dataSources.js`), **Source code** link to GitHub.
- **Mobile** (`max-width: 768px`): fixed ☰ opens drawer; scrim; map full viewport (`100dvh`); `Esc` closes drawer/modal.

---

## Docs & licence

- **User-facing:** `README.md` (features, run, build, data sources, refresh how-to, licence link).
- **Screenshot:** `docs/screenshot.png` for README hero.
- **Licence:** `LICENSE` (MIT), `package.json` `"license": "MIT"`.

---

## When changing behaviour

- New **choropleth**: add to `CHOROPLETH_LAYERS`, usually `SCORE_AREA_DIMS`, `dataSources.js` `DATA_ROWS`, README **Data sources** + refresh commands, run scraper if new file.
- New **POI**: `POINT_LAYERS`, often `SCORE_PROX_DIMS`, scraper, README tables.
- Keep **hash encode/decode** in mind if adding new global state.
