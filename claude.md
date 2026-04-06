# loclocloc

Vite + React + Leaflet app for location/scoring exploration.

## Repo hygiene

- **`scrapers/`** is listed in `.gitignore` so it is not pushed to the public GitHub repo (`12ian34/loclocloc`). Keep one-off or site-specific collection scripts local; published data used by the app should live under paths that *are* tracked (e.g. `public/` assets) if you want them in the repo.
- **`.env`** is gitignored (secrets / API keys).

## Commands

- `npm run dev` — local dev
- `npm run build` — production build
- `npm run lint` — ESLint
