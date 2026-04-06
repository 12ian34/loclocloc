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
    id: "restaurants",
    title: "Restaurants",
    source: "OpenStreetMap (amenity=restaurant)",
    vintage: "Snapshot — same as other OSM POI layers",
  },
  {
    id: "gp-surgeries",
    title: "GP Surgeries",
    source: "OpenStreetMap (amenity=doctors, healthcare=doctor)",
    vintage: "Snapshot — same as other OSM POI layers",
  },
  {
    id: "coworking",
    title: "Coworking Spaces",
    source: "OpenStreetMap (amenity=coworking_space, office=coworking)",
    vintage: "Snapshot — same as other OSM POI layers",
  },
  {
    id: "pop-density",
    title: "Population Density",
    source: "ONS Census 2021 — TS006 (LSOA, persons/km²); XLSX via [UK Data Service CKAN mirror](https://statistics.ukdataservice.ac.uk/dataset/ons_2021_demography_population_density)",
    vintage: "Census 2021 (decennial)",
  },
  {
    id: "ptal",
    title: "PTAL / transport access",
    source: "TfL — LSOA aggregated PTAL stats 2023 (mean access index); CSV via ArcGIS Hub gis-tfl.opendata.arcgis.com (dataset 3eb38b75667a49df9ef1240e9a197615)",
    vintage: "2023 LSOA release (AI values; banded PTAL in source CSV)",
  },
  {
    id: "green-space",
    title: "Green Space",
    source: "OpenStreetMap parks/gardens/greenspace — density scored per LSOA",
    vintage: "Snapshot — re-export when you update layers",
  },
  {
    id: "noise",
    title: "Noise (Lden)",
    source: "Curated from Defra Strategic Noise Mapping Round 4 (2022), IDW interpolated to LSOA",
    vintage: "Based on 2022 Defra noise contour data",
  },
  {
    id: "tiles",
    title: "Basemap",
    source: "CARTO light tiles + OpenStreetMap data",
    vintage: "Live tiles; attribution on map",
  },
];
