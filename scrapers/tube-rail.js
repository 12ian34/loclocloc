#!/usr/bin/env node

/**
 * Scraper for tube and rail stations in London.
 * Uses the OpenStreetMap Overpass API.
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/tube-rail.geojson");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const LONDON_BBOX = "51.28,-0.52,51.70,0.34";

const QUERY = `
[out:json][timeout:60];
(
  node["railway"="station"](${LONDON_BBOX});
  node["station"="subway"](${LONDON_BBOX});
  node["railway"="halt"](${LONDON_BBOX});
  node["station"="light_rail"](${LONDON_BBOX});
);
out;
`;

async function main() {
  console.log("Scraping tube & rail stations in London...\n");

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(QUERY)}`,
  });

  if (!res.ok) {
    console.error(`Overpass API returned HTTP ${res.status}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log(`Overpass returned ${data.elements.length} elements`);

  const seen = new Set();
  const features = [];

  for (const el of data.elements) {
    if (!el.lat || !el.lon) continue;
    const name = el.tags?.name || "Station";
    const key = `${name}-${el.lat.toFixed(3)}-${el.lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Determine station type
    let type = "rail";
    const network = (el.tags?.network || "").toLowerCase();
    const railway = el.tags?.railway || "";
    const station = el.tags?.station || "";
    if (network.includes("underground") || station === "subway") type = "tube";
    else if (network.includes("dlr") || station === "light_rail") type = "dlr";
    else if (network.includes("overground")) type = "overground";
    else if (network.includes("elizabeth") || network.includes("crossrail")) type = "elizabeth";

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [el.lon, el.lat] },
      properties: {
        name,
        type,
        network: el.tags?.network || "",
        zone: el.tags?.zone || el.tags?.["fare_zone"] || "",
      },
    });
  }

  const geojson = { type: "FeatureCollection", features };
  writeFileSync(OUTPUT_PATH, JSON.stringify(geojson, null, 2));
  console.log(`Saved ${features.length} stations to ${OUTPUT_PATH}`);
}

main().catch(console.error);
