#!/usr/bin/env node

/**
 * Scraper for gyms and fitness centres in London.
 * Uses the OpenStreetMap Overpass API.
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/gyms.geojson");
const OVERPASS_URL = "https://overpass.kumi.systems/api/interpreter";
const LONDON_BBOX = "51.35,-0.42,51.65,0.25";

const QUERY = `
[out:json][timeout:120];
node["leisure"="fitness_centre"](${LONDON_BBOX});
out;
`;

async function main() {
  console.log("Scraping gyms in London...\n");

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
        sport: el.tags?.sport || "",
      },
    });
  }

  const geojson = { type: "FeatureCollection", features };
  writeFileSync(OUTPUT_PATH, JSON.stringify(geojson, null, 2));
  console.log(`Saved ${features.length} gyms to ${OUTPUT_PATH}`);
}

main().catch(console.error);
