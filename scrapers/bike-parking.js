#!/usr/bin/env node

/**
 * Scraper for bicycle parking in London.
 * Uses the OpenStreetMap Overpass API.
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writePointLayer } from "./lib/output.js";
import { overpassQuery } from "./lib/overpass.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/bike-parking.geojson");
const LONDON_BBOX = "51.35,-0.42,51.65,0.25";

const QUERY = `
[out:json][timeout:120];
node["amenity"="bicycle_parking"](${LONDON_BBOX});
out;
`;

async function main() {
  console.log("Scraping bike parking in London...\n");

  const data = await overpassQuery(QUERY);
  console.log(`Overpass returned ${data.elements.length} elements`);

  const features = [];

  for (const el of data.elements) {
    const lat = el.lat;
    const lng = el.lon;
    if (!lat || !lng) continue;

    const capacity = el.tags?.capacity || "";
    const type = el.tags?.bicycle_parking || "";
    const covered = el.tags?.covered || "";
    const name = el.tags?.name || `Bike Parking${capacity ? ` (${capacity})` : ""}`;

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        name,
        capacity,
        type,
        covered,
      },
    });
  }

  const geojson = { type: "FeatureCollection", features };
  writePointLayer(OUTPUT_PATH, geojson.features, { source: "OpenStreetMap via Overpass API", vintage: "OSM snapshot at generation date" });
  console.log(`Saved ${features.length} bike parking locations to ${OUTPUT_PATH}`);
}

main().catch(console.error);
