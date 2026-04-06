#!/usr/bin/env node

/**
 * Scraper for restaurants in London.
 * OpenStreetMap Overpass — sharded (restaurants are dense; large bboxes 504).
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { overpassQuery } from "./lib/overpass.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/restaurants.geojson");

/** 8 tiles: 2 lat × 4 lng across Greater London */
const BBOX_SHARDS = [
  [51.35, -0.42, 51.5, -0.2525],
  [51.35, -0.2525, 51.5, -0.085],
  [51.35, -0.085, 51.5, 0.0825],
  [51.35, 0.0825, 51.5, 0.25],
  [51.5, -0.42, 51.65, -0.2525],
  [51.5, -0.2525, 51.65, -0.085],
  [51.5, -0.085, 51.65, 0.0825],
  [51.5, 0.0825, 51.65, 0.25],
];

function queryForBbox(bbox) {
  const s = bbox.join(",");
  return `
[out:json][timeout:90];
node["amenity"="restaurant"](${s});
out;
`;
}

async function main() {
  console.log(`Scraping restaurants in London (${BBOX_SHARDS.length} bbox shards)...\n`);

  const allElements = [];
  for (let i = 0; i < BBOX_SHARDS.length; i++) {
    console.log(`  Shard ${i + 1}/${BBOX_SHARDS.length}...`);
    const data = await overpassQuery(queryForBbox(BBOX_SHARDS[i]));
    allElements.push(...(data.elements || []));
    if (i < BBOX_SHARDS.length - 1) await new Promise((r) => setTimeout(r, 5000));
  }

  console.log(`Overpass returned ${allElements.length} elements (pre-dedupe)`);

  const seenEl = new Set();
  const seenFeat = new Set();
  const features = [];

  for (const el of allElements) {
    const dedupeKey = `${el.type}:${el.id}`;
    if (seenEl.has(dedupeKey)) continue;
    seenEl.add(dedupeKey);

    const lat = el.lat || el.center?.lat;
    const lng = el.lon || el.center?.lon;
    if (!lat || !lng) continue;

    const name = el.tags?.name;
    if (!name) continue;

    const key = `${name}-${lat.toFixed(3)}-${lng.toFixed(3)}`;
    if (seenFeat.has(key)) continue;
    seenFeat.add(key);

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        name,
        cuisine: el.tags?.cuisine || "",
        address: [el.tags?.["addr:street"], el.tags?.["addr:housenumber"]]
          .filter(Boolean).join(" ") || "",
        postcode: el.tags?.["addr:postcode"] || "",
      },
    });
  }

  const geojson = { type: "FeatureCollection", features };
  writeFileSync(OUTPUT_PATH, JSON.stringify(geojson, null, 2));
  console.log(`Saved ${features.length} restaurants to ${OUTPUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
