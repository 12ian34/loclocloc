/**
 * Copy for the in-app “Data & freshness” panel.
 * Update vintage notes when you refresh bundled datasets.
 */

export const BUILD_DATE = __BUILD_DATE__;

export const DATA_INTRO =
  "This app ships static GeoJSON in the repo. Numbers are snapshots, not live feeds. Refresh files when you need newer upstream releases.";

export const DATA_ROWS = [
  {
    id: "poi",
    title: "Points of interest (tube, shops, gyms, …)",
    source: "OpenStreetMap via Overpass API",
    vintage: "Snapshot — re-export when you update layers",
  },
  {
    id: "libraries",
    title: "Libraries",
    source: "OpenStreetMap (amenity=library)",
    vintage: "Snapshot — same as other OSM POI layers",
  },
  {
    id: "crime",
    title: "Crime (current layer)",
    source: "data.police.uk street-level outcomes",
    vintage: "Check export date in your pipeline when you regenerate",
  },
  {
    id: "air",
    title: "Air quality (NO₂)",
    source: "London Air Quality Network — interpolated to LSOA",
    vintage: "Depends on your last air-quality export",
  },
  {
    id: "rent-est",
    title: "Est. rent (£/mo)",
    source: "Modelled from IMD 2019 + hand-tuned borough median anchors (see scrapers/rent.js)",
    vintage: "Indicative only — not ONS or listing data",
  },
  {
    id: "imd",
    title: "Deprivation & IMD subdomains",
    source: "ONS — Index of Multiple Deprivation 2019",
    vintage: "IMD 2019 (next national update is infrequent)",
  },
  {
    id: "tiles",
    title: "Basemap",
    source: "CARTO light tiles + OpenStreetMap data",
    vintage: "Live tiles; attribution on map",
  },
];
