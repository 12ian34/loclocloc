/**
 * Copy for the in-app "Data & freshness" panel.
 *
 * Freshness (generated date, feature count, vintage label) comes from /data/manifest.json,
 * which scripts/build-manifest.js assembles from the `meta` block every scraper writes.
 * This file only holds the human-readable descriptions keyed by data-file id.
 */

import { POINT_LAYERS, CHOROPLETH_LAYERS } from "./config.js";

export const BUILD_DATE = __BUILD_DATE__;

export const DATA_INTRO =
  "This app ships static data files in the repo. Numbers are snapshots, not live feeds; each layer below shows when its file was last generated.";

/** Descriptions by data-file id (the basename of the file under public/data). */
export const DATA_SOURCES = {
  "lsoa-boundaries": { title: "LSOA boundaries", source: "ONS Open Geography Portal — Lower layer Super Output Areas (December 2021), generalised, filtered to London boroughs" },
  crime: { title: "Crime (current)", source: "data.police.uk street-level crime API, grid-sampled and assigned to nearest LSOA centroid" },
  "air-quality": { title: "Air quality (NO₂)", source: "London Air Quality Network / Defra annual means, inverse-distance interpolated to LSOA" },
  rent: { title: "Est. rent (£/mo)", source: "Modelled from deprivation signals + borough anchor rents (scrapers/rent.js) — indicative only, not listings" },
  imd: { title: "Deprivation (IMD) & domains", source: "MHCLG English Indices of Deprivation, LSOA scores" },
  "population-density": { title: "Population density", source: "ONS Census 2021 TS006 (usual residents per km²)" },
  ptal: { title: "PTAL / transport access", source: "TfL LSOA aggregated PTAL stats 2023 — mean access index" },
  "green-space": { title: "Green space", source: "OpenStreetMap parks, gardens and greenspace — proximity-weighted count per LSOA" },
  noise: { title: "Noise (Lden)", source: "Curated points informed by Defra strategic noise mapping, interpolated to LSOA" },
  "house-prices": { title: "House prices", source: "ONS HPSSA dataset 46 — median price paid by LSOA (HM Land Registry), 2011 codes mapped to 2021" },
  "flood-risk": { title: "Flood risk (Zone 3)", source: "Environment Agency Flood Map for Planning — % of LSOA area inside Flood Zone 3 (undefended), by grid sampling" },
  broadband: { title: "Gigabit broadband", source: "Ofcom Connected Nations 2025 — % premises with gigabit-capable availability, output areas summed to LSOA" },
  schools: { title: "Schools", source: "DfE Get Information about Schools (GIAS) daily extract + Ofsted management information joined by URN" },
  supermarkets: { title: "Supermarkets", source: "OpenStreetMap (shop=supermarket)" },
  dentists: { title: "Dentists", source: "OpenStreetMap (amenity=dentist, healthcare=dentist)" },
};

/** Static rows for things that are not bundled files. */
export const LIVE_ROWS = [
  { id: "postcodes", title: "Postcode search", source: "postcodes.io (Ordnance Survey open data)", vintage: "Live" },
  { id: "tfl", title: "Transit isochrones", source: "TfL Journey Planner API", vintage: "Live (optional key)" },
  { id: "tiles", title: "Basemap", source: "CARTO Positron raster tiles + OpenStreetMap data", vintage: "Live tiles; attribution on map" },
];

const fileId = (file) => file.replace(/^\/data\//, "").replace(/\.(geo)?json$/, "");

/**
 * Rows for the modal: every bundled file in sidebar order, joined with manifest freshness.
 * Works without a manifest (shows "unknown" for generated date).
 */
export function buildDataRows(manifest) {
  const layers = manifest?.layers ?? {};
  const seen = new Set();
  const rows = [];
  const push = (id, fallbackTitle) => {
    if (seen.has(id)) return;
    seen.add(id);
    const meta = layers[id];
    const desc = DATA_SOURCES[id] ?? {};
    rows.push({
      id,
      title: desc.title ?? fallbackTitle ?? id,
      source: desc.source ?? meta?.source ?? "",
      vintage: meta?.vintage ?? "",
      generated: meta?.generated ?? null,
      count: meta?.count ?? null,
    });
  };
  push("lsoa-boundaries");
  for (const l of CHOROPLETH_LAYERS) push(fileId(l.file), l.name);
  for (const l of POINT_LAYERS) push(fileId(l.file), l.name);
  for (const id of Object.keys(layers)) push(id);
  return rows;
}
