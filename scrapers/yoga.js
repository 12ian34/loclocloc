#!/usr/bin/env node

/**
 * Scraper for yoga studios in London.
 * Uses the OpenStreetMap Overpass API to find places tagged as yoga studios.
 * Outputs GeoJSON to public/data/yoga.geojson
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/yoga.geojson");

// Overpass API endpoint
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// London bounding box: south, west, north, east
const LONDON_BBOX = "51.28,-0.52,51.70,0.34";

// Overpass QL query for yoga studios in London
const QUERY = `
[out:json][timeout:60];
(
  // Leisure=fitness_centre with sport=yoga
  node["leisure"="fitness_centre"]["sport"~"yoga"](${LONDON_BBOX});
  way["leisure"="fitness_centre"]["sport"~"yoga"](${LONDON_BBOX});
  // Specifically tagged as yoga
  node["sport"="yoga"](${LONDON_BBOX});
  way["sport"="yoga"](${LONDON_BBOX});
  // Studios/shops with yoga in the name
  node["leisure"="fitness_centre"]["name"~"[Yy]oga"](${LONDON_BBOX});
  way["leisure"="fitness_centre"]["name"~"[Yy]oga"](${LONDON_BBOX});
  node["shop"="sports"]["name"~"[Yy]oga"](${LONDON_BBOX});
  way["shop"="sports"]["name"~"[Yy]oga"](${LONDON_BBOX});
  // Amenity with yoga
  node["amenity"]["name"~"[Yy]oga"](${LONDON_BBOX});
  way["amenity"]["name"~"[Yy]oga"](${LONDON_BBOX});
);
out center;
`;

async function main() {
  console.log("Scraping yoga studios in London from OpenStreetMap...\n");

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

  // Deduplicate by name+location proximity
  const seen = new Set();
  const features = [];

  for (const el of data.elements) {
    const lat = el.lat || el.center?.lat;
    const lng = el.lon || el.center?.lon;
    if (!lat || !lng) continue;

    const name = el.tags?.name || "Yoga Studio";
    // Dedup key: name + rough location
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
        address:
          [el.tags?.["addr:street"], el.tags?.["addr:housenumber"]]
            .filter(Boolean)
            .join(" ") || "",
        postcode: el.tags?.["addr:postcode"] || "",
        website: el.tags?.website || el.tags?.["contact:website"] || "",
        phone: el.tags?.phone || el.tags?.["contact:phone"] || "",
      },
    });
  }

  const geojson = { type: "FeatureCollection", features };

  writeFileSync(OUTPUT_PATH, JSON.stringify(geojson, null, 2));
  console.log(`\nSaved ${features.length} yoga studios to ${OUTPUT_PATH}`);
}

main().catch(console.error);
