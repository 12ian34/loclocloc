#!/usr/bin/env node

/**
 * Scraper for parks and green spaces in London.
 * Uses the OpenStreetMap Overpass API.
 * Outputs GeoJSON to public/data/parks.geojson
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/parks.geojson");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const LONDON_BBOX = "51.28,-0.52,51.70,0.34";

const QUERY = `
[out:json][timeout:90];
(
  way["leisure"="park"](${LONDON_BBOX});
  relation["leisure"="park"](${LONDON_BBOX});
  way["leisure"="garden"]["access"!="private"](${LONDON_BBOX});
  relation["leisure"="garden"]["access"!="private"](${LONDON_BBOX});
  way["leisure"="nature_reserve"](${LONDON_BBOX});
  relation["leisure"="nature_reserve"](${LONDON_BBOX});
);
out center;
`;

async function main() {
  console.log("Scraping parks and green spaces in London from OpenStreetMap...\n");

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
    if (!name) continue; // skip unnamed small patches

    const key = `${name}-${lat.toFixed(3)}-${lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lng, lat],
      },
      properties: {
        name,
        type: el.tags?.leisure || "park",
        website: el.tags?.website || "",
      },
    });
  }

  const geojson = { type: "FeatureCollection", features };

  writeFileSync(OUTPUT_PATH, JSON.stringify(geojson, null, 2));
  console.log(`\nSaved ${features.length} parks to ${OUTPUT_PATH}`);
}

main().catch(console.error);
