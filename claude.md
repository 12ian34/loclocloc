# loclocloc

Vite + React + Leaflet app for location/scoring exploration.

- **Live:** https://loclocloc.netlify.app
- **Repo:** https://github.com/12ian34/loclocloc

## Repo hygiene

- **`scrapers/`** is listed in `.gitignore` so it is not pushed to the public GitHub repo (`12ian34/loclocloc`). Keep one-off or site-specific collection scripts local; published data used by the app should live under paths that *are* tracked (e.g. `public/` assets) if you want them in the repo.
- **`.env`** is gitignored (secrets / API keys).

## Commands

- `npm run dev` — local dev
- `npm run build` — production build
- `npm run lint` — ESLint

## Sidebar UX

- Default: no POI layers, no area choropleth; **Filter Areas** expanded; POI / Area Data sections can collapse via their headers.
- Re-clicking the active area overlay row clears it (same as **Clear overlay**).

## Docs

- **`README.md`** — user-facing overview; hero image is **`docs/screenshot.png`** (capture: `npm run build && npm run preview -- --host 127.0.0.1 --port 4173`, then `npx playwright@1.49.1 screenshot --viewport-size=1440,900 --wait-for-timeout=5000 http://127.0.0.1:4173/ docs/screenshot.png` after `npx playwright@1.49.1 install chromium` if needed).
