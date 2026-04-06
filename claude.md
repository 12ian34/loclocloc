# loclocloc

Vite + React + Leaflet app for location/scoring exploration.

- **Live:** https://loclocloc.netlify.app
- **Repo:** https://github.com/12ian34/loclocloc

## Repo hygiene

- **`scrapers/`** — Node scripts to refresh GeoJSON under `public/data/` (Overpass, open data, etc.). Respect each source’s terms and rate limits when you run them.
- **`.env`** is gitignored (secrets / API keys).

## Commands

- `npm run dev` — local dev
- `npm run build` — production build
- `npm run lint` — ESLint

## Sidebar UX

- Default: no POI layers, no area choropleth; **Filter Areas** expanded; POI / Area Data sections can collapse via their headers.
- Re-clicking the active area overlay row clears it (same as **Clear overlay**).
- Footer: **Copy share link**, **Data & freshness** modal, **Source code on GitHub**. On narrow viewports the sidebar is a drawer (☰); map is full viewport.

## Data / legal

- **`LICENSE`** — MIT.
- **`src/dataSources.js`** — copy for the data/freshness modal; **`__BUILD_DATE__`** injected in `vite.config.js` at build time.
- **Libraries POI:** `public/data/libraries.geojson` — regen: `node scrapers/libraries.js` (Overpass).

## Docs

- **`README.md`** — user-facing overview; hero image is **`docs/screenshot.png`** (capture: `npm run build && npm run preview -- --host 127.0.0.1 --port 4173`, then `npx playwright@1.49.1 screenshot --viewport-size=1440,900 --wait-for-timeout=5000 http://127.0.0.1:4173/ docs/screenshot.png` after `npx playwright@1.49.1 install chromium` if needed).
