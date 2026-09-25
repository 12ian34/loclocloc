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
| Sidebar widgets | `src/components/Sidebar.jsx` — includes **`InfoTip`**: hover tooltip on pointer devices; **tap toggles** + outside dismiss on touch (choropleth rows + score rows). Tooltips use **`score-info--tooltip-end`** so they stay inside the sidebar and are not clipped by the map. |
| Styles | `src/App.css` (includes mobile drawer, data modal, sidebar footer; sidebar/modal text colours tuned for contrast on dark panels) |
| Data copy (modal) | `src/dataSources.js` — `BUILD_DATE` from Vite `define` |
| Boot | `src/main.jsx`, `index.html` |
| Build | `vite.config.js` — `__BUILD_DATE__` injected at build time |
| Lint | `eslint.config.js` — browser globals + `__BUILD_DATE__` |

---

## URL / state

- App state is synced to **`window.location.hash`** (query-style params): postcodes `p`, layers `l`, choropleth `c`, opacity `o`, walk rings `r`, filters `f` (JSON).
- Helpers: `encodeAppState` / `decodeAppState` in `src/utils/url.js`.
- **Copy share link** in sidebar copies full `href` (includes hash).

---

## Layers (IDs matter for URL + scoring)

**POIs** — `POINT_LAYERS`: each `{ id, name, file, color, emoji }` (`color` unused in sidebar UI; list shows emoji + name). Lazy-loaded into `layerData` (see **Loading strategy**); sidebar counts come from the manifest until then. Non-OSM layer: **`schools`** (DfE GIAS + Ofsted MI; popup shows phase / sector / latest Ofsted outcome via `PoiExtra` in `MapLayers.jsx`, which also shows supermarket `brand` and dentist `nhs`). **Clear all POIs** turns off every active POI layer at once (same `.clear-choropleth` style as choropleth clear).

**Choropleths** — `CHOROPLETH_LAYERS`: each `{ id, name, file, property, emoji, unit, colorStops, format, inverse, tip? }`. Optional **`tip`** powers the **i** hover tooltip in the Area Data list (same `score-info` / `score-tooltip` pattern as score rows). Multiple entries can share one **file** (e.g. IMD domains); loader dedupes by `file` and fills `choroplethData[id]` per layer id.

**Notable choropleth ids**

- `crime-current`, `air`, **`house-prices`** (ONS HPSSA 46 real sale prices — drives the affordability score + filter), **`rent-est`** (modelled; choropleth only, dropped from scoring Sept 2026 to avoid double-counting affordability), `imd`, `imd-*` domains (IoD2025), `pop-density`, **`ptal`** (TfL mean access index), **`green-space`**, **`noise`** (modelled Lden), **`flood-risk`** (EA Flood Zone 3 area share, undefended), **`broadband`** (Ofcom gigabit availability, `inverse: false`).
- Re-clicking the active choropleth row clears it (`toggleChoropleth`).

**Defaults** — no POI layers on; no choropleth; Filter Areas section expanded; POI / Area sections collapsible.

---

## Scoring (`computePostcodeScores`)

- **Area** (`SCORE_AREA_DIMS`): LSOA from point-in-polygon (or nearest centroid); percentile of raw value in London distribution; default score = `round(100 - percentile)` (**lower raw = better**). Dims with **`inverse: false`** use `round(percentile)` (**higher raw = better**, e.g. `ptal`, `green-space`).
- **Proximity** (`SCORE_PROX_DIMS`): density-weighted distance sum vs `cap`; some dims use `inverse` (e.g. betting).
- **Overall**: mean of enabled area + proximity scores.
- Users can disable dimensions on the scorecard (`disabledScoreDims`).

---

## Filters

- `FILTER_CHOROPLETH_DIMS` in `config.js` drives `FilterPanel`: max-threshold dims (crime, air, house-prices, IMD, pop-density, noise, flood-risk) and min-threshold dims (`ptal`, `green-space`, `broadband`). `filterPassSet` in `App.jsx` applies **all** active rules by LSOA `code`.
- Filter-only green/grey overlay draws the shared `boundaries` polygons when no choropleth is active.

---

## API keys (build-time env)

- `VITE_CARTO_API_KEY` — CARTO basemap key, read in `App.jsx` as `import.meta.env.VITE_CARTO_API_KEY` and appended as `?key=` to the `rastertiles/light_all` tile URL. **Required since 2026-09-23**: without it CARTO still serves tiles but watermarks them "API KEY REQUIRED". Free tier (non-commercial) via https://carto.com/basemaps/apikey/. Same handling as the TfL key: local `.env`, Netlify env var, never in git or README.
- `VITE_TFL_API_KEY` — read in client as `import.meta.env.VITE_TFL_API_KEY`. If empty, transit isochrones still UI-visible but API calls won’t authenticate.
- **Do not** document key setup in README (project choice); hosts inject at **build** time for production.

---

## Scrapers & data

- **`scrapers/*.js`** — regenerate files under `public/data/`. Full procedure: **`README.md`** **Updating bundled data** + **Data sources**. Raw downloads (xlsx/csv/zip) are cached under **`scrapers/.cache/`** (gitignored), never under `public/data`.
- **Data shapes** (enforced by **`scrapers/lib/output.js`** — every scraper must end with one of its writers):
  - **`/data/lsoa-boundaries.geojson`** — the 4,994 London LSOA 2021 polygons (`code`, `name`, `borough`). Fetched **once** by the client; produced/cached by `scrapers/lib/boundaries.js`.
  - **Area layers `/data/<id>.json`** — `{ meta, values: { [code]: number | object } }` written by **`writeAreaLayer`**. No geometry; the client joins onto the boundaries with `mergeAreaLayer` (`src/utils/data.js`), which also builds a `byCode` map used by scoring and filters. One property → bare number; several (IMD) → object.
  - **POI layers `/data/<id>.geojson`** — minified FeatureCollection with a top-level `meta` block, coords rounded to 5 dp, written by **`writePointLayer`**.
  - **`meta`** = `{ id, source, vintage, generated (YYYY-MM-DD), count, properties? }`. **`scripts/build-manifest.js`** (runs on `prebuild`, or `npm run manifest`) collects all meta into **`/data/manifest.json`**, which the client uses for sidebar POI counts before a layer is loaded and for the **Data & freshness** modal (`buildDataRows` in `dataSources.js`).
- **Loading strategy** (`App.jsx`): startup fetches manifest + boundaries + all area tables (~3 MB raw). **POI files are lazy**: `ensurePointLayers` fetches a layer on first toggle, all layers on the first pinned postcode (proximity scoring needs them), and any layers named in the URL hash on mount. `poiLoading` drives the loading banner.
- **Caching:** `netlify.toml` sets long immutable caching for `/assets/*` and a one-day `stale-while-revalidate` policy for `/data/*`.
- **Monthly refresh:** `.github/workflows/refresh-data.yml` reruns the scrapers on a schedule (or `workflow_dispatch`) and opens a PR on branch `data/monthly-refresh`; Overpass-heavy scrapers are allowed to fail individually.
- **Tests:** `npm test` (vitest) covers `utils/url.js`, `utils/data.js` and scoring in `utils/geo.js` (`src/utils/__tests__/`). Lint covers scrapers too (Node globals block in `eslint.config.js`).

### SheetJS `xlsx` (spreadsheet parsing)

- **Do not use** the public npm registry package `xlsx` for version bumps — it is **frozen at 0.18.5** and is **unmaintained** there. Patched releases are published only on **[cdn.sheetjs.com](https://cdn.sheetjs.com/)** (see [Node install docs](https://docs.sheetjs.com/docs/getting-started/installation/nodejs)).
- **Security:** CE versions **before 0.19.3** were reported vulnerable to **prototype pollution** when reading malicious files; **before 0.20.2** to **ReDoS**. This repo pins **SheetJS 0.20.3** via tarball URL in **`package.json`**:  
  `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`  
  `package-lock.json` records `resolved` + `integrity`; **`npm audit`** should show **no** `xlsx` issues after install.
- **ESM scrapers:** SheetJS’s **ESM** build (`xlsx.mjs`) does not auto-bind Node `fs`. Any scraper that uses **`XLSX.readFile`** must call **`XLSX.set_fs(fs)`** once (after `import * as fs from "fs"`). **`scrapers/imd.js`** and **`scrapers/rent.js`** do this. **`scrapers/population-density.js`** only uses **`XLSX.read(buf, { type: "buffer" })`** — no `set_fs` needed.
- **CI / Netlify:** `npm install` needs network access to fetch the tarball the first time (or when the lockfile changes). **Optional supply-chain hardening:** vendor the `.tgz` (e.g. under `vendor/`) and depend on `xlsx@file:vendor/xlsx-0.20.3.tgz` per SheetJS vendoring instructions — enables offline / pinned installs without hitting the CDN each time.
- **User-facing note:** `README.md` explains that spreadsheet support uses the CDN tarball, not registry `xlsx`.

- **`scrapers/lib/boundaries.js`** — ONS ArcGIS LSOA 2021 for London; shared by every area scraper.
- **`scrapers/lib/overpass.js`** — rotates public Overpass endpoints + retries (used by heavy POI / green-space scrapers).
- **`scrapers/rent.js`** — outputs **`rent.json`**; modelled from IoD2025 signals + borough anchor table inside file (indicative only).

---

## Deploy (Netlify)

- Build: `npm run build`, publish **`dist`** (see `netlify.toml`).
- Client bundle includes any `VITE_*` present at build time.

---

## UX extras

- **Postcode search** (`PostcodeSearch` in `Sidebar.jsx`): mint gradient frame on the field (stronger on focus), example placeholder; `search-block` on the form in `App.css`.
- **Walk & transit** — collapsible sidebar section (same pattern as POI / Area): walk rings (`WALK_RINGS` in `config.js`: 5/15/30/45 min, labels north of each ring on the map) + transit isochrones (`TRANSIT_RINGS`: 15/30/45 min, labels past the northernmost vertex of each polygon, colour matches that pin’s isochrone stroke) + transit isochrone toggles; short hint about TfL latency. **Transit** opens `ConfirmModal` only when a pinned postcode still needs a fetch; `transitData` + `transitDataRef` cache per pin (hide overlay does not clear). **Clear** all pins resets transit cache. Loading shows a horizontal mint fill on the transit button; `computeTransitIsochrones` in `tfl.js` accepts optional batch `onProgress`. **Heavy POI layers** (`HEAVY_POI_LAYER_IDS` in `config.js`: bike parking, restaurants) open the same modal pattern before enabling.
- Sidebar footer: **Copy share link**, **Data & freshness** modal (`DataAboutModal` + `dataSources.js`), **Source code** link to GitHub.
- **Mobile** (`max-width: 768px`): fixed ☰ opens drawer; scrim; map full viewport (`100dvh`); `Esc` closes drawer/modal.

---

## Docs & licence

- **User-facing:** `README.md` (features, run, build, data sources, refresh how-to, licence link).
- **README hero images:** `docs/hero-1.png`, `docs/hero-2.png`.
- **Licence:** `LICENSE` (MIT), `package.json` `"license": "MIT"`.

---

## When changing behaviour

- New **choropleth**: scraper ending in `writeAreaLayer` → `/data/<id>.json`; add to `CHOROPLETH_LAYERS` (`file` = the .json), usually `SCORE_AREA_DIMS` + `FILTER_CHOROPLETH_DIMS`, a `DATA_SOURCES` entry in `dataSources.js`, README **Data sources** + refresh commands + the workflow's scraper list, then `npm run manifest`.
- New **POI**: scraper ending in `writePointLayer` → `/data/<id>.geojson`; `POINT_LAYERS`, often `SCORE_PROX_DIMS`, `DATA_SOURCES`, README tables, workflow list, `npm run manifest`.
- Keep **hash encode/decode** in mind if adding new global state.
