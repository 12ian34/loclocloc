#!/usr/bin/env node

/**
 * Scraper for coworking spaces in London.
 * Uses the OpenStreetMap Overpass API.
 * Queries both amenity=coworking_space and office=coworking tags.
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writePointLayer } from "./lib/output.js";
import { overpassQuery } from "./lib/overpass.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/coworking.geojson");
const LONDON_BBOX = "51.35,-0.42,51.65,0.25";

const QUERY = `
[out:json][timeout:120];
(
  node["amenity"="coworking_space"](${LONDON_BBOX});
  node["office"="coworking"](${LONDON_BBOX});
);
out;
`;

async function main() {
  console.log("Scraping coworking spaces in London...\n");

  const data = await overpassQuery(QUERY);
  console.log(`Overpass returned ${data.elements.length} elements`);

  const seen = new Set();
  const features = [];

  for (const el of data.elements) {
    const lat = el.lat || el.center?.lat;
    const lng = el.lon || el.center?.lon;
    if (!lat || !lng) continue;

    const name = el.tags?.name;
    if (!name) continue;

    const key = `${name}-${lat.toFixed(3)}-${lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        name,
        address: [el.tags?.["addr:street"], el.tags?.["addr:housenumber"]]
          .filter(Boolean).join(" ") || "",
        postcode: el.tags?.["addr:postcode"] || "",
        operator: el.tags?.operator || "",
      },
    });
  }

  const geojson = { type: "FeatureCollection", features };
  writePointLayer(OUTPUT_PATH, geojson.features, { source: "OpenStreetMap via Overpass API", vintage: "OSM snapshot at generation date" });
  console.log(`Saved ${features.length} coworking spaces to ${OUTPUT_PATH}`);
}

main().catch(console.error);
