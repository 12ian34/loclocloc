/**
 * Fetches London borough boundaries from the ONS Open Geography Portal.
 * Returns GeoJSON FeatureCollection with borough polygons.
 * London boroughs have ONS codes starting with E09.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(__dirname, "../../public/data/_borough-boundaries.geojson");

const ONS_URL =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Local_Authority_Districts_May_2024_Boundaries_UK_BSC/FeatureServer/0/query";

export async function getBoroughBoundaries() {
  // Return cached if available
  if (existsSync(CACHE_PATH)) {
    console.log("Using cached borough boundaries");
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  }

  console.log("Fetching London borough boundaries from ONS...");

  const params = new URLSearchParams({
    where: "LAD24CD LIKE 'E09%'",
    outFields: "LAD24CD,LAD24NM",
    f: "geojson",
    outSR: "4326",
  });

  const res = await fetch(`${ONS_URL}?${params}`);
  if (!res.ok) {
    console.warn(`ONS API returned ${res.status}, trying fallback...`);
    return getFallbackBoundaries();
  }

  const geojson = await res.json();

  if (!geojson.features || geojson.features.length === 0) {
    console.warn("ONS returned no features, trying fallback...");
    return getFallbackBoundaries();
  }

  // Normalize property names
  for (const f of geojson.features) {
    f.properties.code = f.properties.LAD24CD;
    f.properties.name = f.properties.LAD24NM;
  }

  writeFileSync(CACHE_PATH, JSON.stringify(geojson));
  console.log(`Cached ${geojson.features.length} borough boundaries`);
  return geojson;
}

function getFallbackBoundaries() {
  // Try older ONS endpoint
  return fetchFallback();
}

async function fetchFallback() {
  const urls = [
    "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Local_Authority_Districts_December_2023_Boundaries_UK_BSC/FeatureServer/0/query",
    "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Local_Authority_Districts_December_2022_Boundaries_UK_BSC/FeatureServer/0/query",
  ];

  for (const url of urls) {
    try {
      const codeField = url.includes("2023") ? "LAD23CD" : "LAD22CD";
      const nameField = url.includes("2023") ? "LAD23NM" : "LAD22NM";

      const params = new URLSearchParams({
        where: `${codeField} LIKE 'E09%'`,
        outFields: `${codeField},${nameField}`,
        f: "geojson",
        outSR: "4326",
      });

      console.log(`Trying fallback: ${url.match(/\d{4}/)?.[0]} boundaries...`);
      const res = await fetch(`${url}?${params}`);
      if (!res.ok) continue;

      const geojson = await res.json();
      if (!geojson.features?.length) continue;

      for (const f of geojson.features) {
        f.properties.code = f.properties[codeField];
        f.properties.name = f.properties[nameField];
      }

      writeFileSync(CACHE_PATH, JSON.stringify(geojson));
      console.log(`Cached ${geojson.features.length} borough boundaries (fallback)`);
      return geojson;
    } catch {
      continue;
    }
  }

  throw new Error("Could not fetch borough boundaries from any source");
}
