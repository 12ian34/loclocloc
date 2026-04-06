#!/usr/bin/env node

/**
 * Scraper for pubs in London.
 * Uses the OpenStreetMap Overpass API.
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/pubs.geojson");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const LONDON_BBOX = "51.35,-0.42,51.65,0.25";

const QUERY = `
[out:json][timeout:120];
node["amenity"="pub"](${LONDON_BBOX});
out;
`;

async function main() {
  console.log("Scraping pubs in London...\n");

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
        real_ale: el.tags?.real_ale || "",
        beer_garden: el.tags?.beer_garden || "",
      },
    });
  }

  const geojson = { type: "FeatureCollection", features };
  writeFileSync(OUTPUT_PATH, JSON.stringify(geojson, null, 2));
  console.log(`Saved ${features.length} pubs to ${OUTPUT_PATH}`);
}

main().catch(console.error);
