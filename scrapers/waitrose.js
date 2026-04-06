#!/usr/bin/env node

/**
 * Scraper for Waitrose store locations in London.
 * Uses OpenStreetMap Overpass API for real, complete data.
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/waitrose.geojson");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const LONDON_BBOX = "51.28,-0.52,51.70,0.34";

const QUERY = `
[out:json][timeout:120];
(
  node["shop"~"supermarket|convenience"]["brand"~"Waitrose",i](${LONDON_BBOX});
  way["shop"~"supermarket|convenience"]["brand"~"Waitrose",i](${LONDON_BBOX});
  node["shop"~"supermarket|convenience"]["name"~"Waitrose",i](${LONDON_BBOX});
  way["shop"~"supermarket|convenience"]["name"~"Waitrose",i](${LONDON_BBOX});
);
out center;
`;

async function main() {
  console.log("Scraping Waitrose locations from OpenStreetMap...\n");

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

    const name = el.tags?.name || "Waitrose";
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
      },
    });
  }

  const geojson = { type: "FeatureCollection", features };
  writeFileSync(OUTPUT_PATH, JSON.stringify(geojson, null, 2));
  console.log(`Saved ${features.length} Waitrose locations to ${OUTPUT_PATH}`);
}

main().catch(console.error);
