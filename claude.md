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

**POIs** — `POINT_LAYERS`: each `{ id, name, file, color, emoji }` (`color` unused in sidebar UI; list shows emoji + name). Fetched on load into `layerData`. **Clear all POIs** turns off every active POI layer at once (same `.clear-choropleth` style as choropleth clear).

**Choropleths** — `CHOROPLETH_LAYERS`: each `{ id, name, file, property, emoji, unit, colorStops, format, inverse, tip? }`. Optional **`tip`** powers the **i** hover tooltip in the Area Data list (same `score-info` / `score-tooltip` pattern as score rows). Multiple entries can share one **file** (e.g. IMD domains); loader dedupes by `file` and fills `choroplethData[id]` per layer id.

**Notable choropleth ids**

- `crime-current`, `air`, `imd`, `imd-*` domains, **`rent-est`**, `pop-density`, **`ptal`** (TfL mean access index), **`green-space`**, **`noise`** (modelled Lden).
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

- `FILTER_CHOROPLETH_DIMS` in `config.js` drives `FilterPanel`: max-threshold dims (e.g. crime, air, rent, IMD, pop-density, noise) and min-threshold dims (`ptal`, `green-space`). `filterPassSet` in `App.jsx` applies **all** active rules by LSOA `code`.
- Filter-only green/grey overlay uses IMD or crime geometry as reference when no choropleth is active.

---

## Optional TfL

- `VITE_TFL_API_KEY` — read in client as `import.meta.env.VITE_TFL_API_KEY`. If empty, transit isochrones still UI-visible but API calls won’t authenticate.
- **Do not** document key setup in README (project choice); hosts inject at **build** time for production.

---

## Scrapers & data

- **`scrapers/*.js`** — regenerate `public/data/*.geojson` (and caches e.g. `_lsoa-boundaries.geojson`, `_imd_scores.xlsx`, `_population-density-ts006.xlsx`, `_ptal-lsoa-2023.csv`). Full procedure: **`README.md`** **Updating bundled data** + **Data sources**.

### SheetJS `xlsx` (spreadsheet parsing)

- **Do not use** the public npm registry package `xlsx` for version bumps — it is **frozen at 0.18.5** and is **unmaintained** there. Patched releases are published only on **[cdn.sheetjs.com](https://cdn.sheetjs.com/)** (see [Node install docs](https://docs.sheetjs.com/docs/getting-started/installation/nodejs)).
- **Security:** CE versions **before 0.19.3** were reported vulnerable to **prototype pollution** when reading malicious files; **before 0.20.2** to **ReDoS**. This repo pins **SheetJS 0.20.3** via tarball URL in **`package.json`**:  
  `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`  
  `package-lock.json` records `resolved` + `integrity`; **`npm audit`** should show **no** `xlsx` issues after install.
- **ESM scrapers:** SheetJS’s **ESM** build (`xlsx.mjs`) does not auto-bind Node `fs`. Any scraper that uses **`XLSX.readFile`** must call **`XLSX.set_fs(fs)`** once (after `import * as fs from "fs"`). **`scrapers/imd.js`** and **`scrapers/rent.js`** do this. **`scrapers/population-density.js`** only uses **`XLSX.read(buf, { type: "buffer" })`** — no `set_fs` needed.
- **CI / Netlify:** `npm install` needs network access to fetch the tarball the first time (or when the lockfile changes). **Optional supply-chain hardening:** vendor the `.tgz` (e.g. under `vendor/`) and depend on `xlsx@file:vendor/xlsx-0.20.3.tgz` per SheetJS vendoring instructions — enables offline / pinned installs without hitting the CDN each time.
- **User-facing note:** `README.md` explains that spreadsheet support uses the CDN tarball, not registry `xlsx`.

- **`scrapers/lib/boundaries.js`** — ONS ArcGIS LSOA 2021 for London; shared by IMD, crime, air, rent, population-density, ptal, noise, green-space, etc.
- **`scrapers/lib/overpass.js`** — rotates public Overpass endpoints + retries (used by heavy POI / green-space scrapers).
- **`scrapers/rent.js`** — outputs **`rent.geojson`**; IMD 2011 codes mapped / imputed to 2021 LSOAs; borough anchor table inside file.

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

- New **choropleth**: add to `CHOROPLETH_LAYERS`, usually `SCORE_AREA_DIMS`, `dataSources.js` `DATA_ROWS`, README **Data sources** + refresh commands, run scraper if new file.
- New **POI**: `POINT_LAYERS`, often `SCORE_PROX_DIMS`, scraper, README tables.
- Keep **hash encode/decode** in mind if adding new global state.
