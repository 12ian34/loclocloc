# loclocloc

<p align="center">
  <img src="docs/screenshot.png" alt="loclocloc — London map with sidebar layer toggles (Tube &amp; Rail, amenities, area data)" width="920" />
</p>

**Find your spot in London** — an interactive map to explore amenities, public transport, and neighbourhood context side by side. Pin postcodes, toggle layers, and see how areas compare at a glance.

## What you can do

- **Search postcodes** — jump to an area and keep a shortlist of places you care about.
- **Point layers** — tube and rail, groceries, coffee, pubs, parks, gyms, cinemas, bike parking, and more. Each layer can be switched on or off.
- **Area layers** — choropleths for crime, air quality (NO₂), and Index of Multiple Deprivation dimensions, so you can read “how this patch of the city feels” next to the map.
- **Scorecards** — blended scores for each pinned postcode (proximity + area signals), with short explanations on what each metric means.
- **Optional travel-time rings** — with a [Transport for London](https://api.tfl.gov.uk/) API key, show public-transit reach from your pins (see setup below).

Data is bundled as static GeoJSON in the repo, so the map works offline once built — no database required.

## Run it locally

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

### TfL journey overlays (optional)

Create a `.env` file in the project root:

```bash
VITE_TFL_API_KEY=your_primary_key
```

Register for a free app key at [api.tfl.gov.uk](https://api.tfl.gov.uk/). Without a key, the rest of the app still works; transit isochrones stay disabled.

## Build for production

```bash
npm run build
npm run preview   # serve the dist/ folder locally
```

## Data & attribution

Layers combine open and public-sector sources (e.g. OpenStreetMap-derived points, police crime summaries, air-quality monitoring, ONS deprivation statistics). Interpretation is for exploration only — not planning, legal, or financial advice.

Map tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, © [CARTO](https://carto.com/).

---

*Built with [Vite](https://vitejs.dev/), [React](https://react.dev/), and [Leaflet](https://leafletjs.com/).*
