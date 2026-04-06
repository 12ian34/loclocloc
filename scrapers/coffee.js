#!/usr/bin/env node

/**
 * Scraper for independent coffee shops in London.
 * Uses Overpass API, filters out known chains.
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/coffee.geojson");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const LONDON_BBOX = "51.28,-0.52,51.70,0.34";

const CHAINS = new Set([
  "starbucks", "costa coffee", "costa", "caffè nero", "caffe nero",
  "pret a manger", "pret", "greggs", "mcdonald's", "mcdonalds",
  "subway", "burger king", "kfc", "tim hortons", "dunkin",
  "coffee#1", "coffee republic", "wild bean cafe", "insomnia coffee",
  "black sheep coffee", "joe & the juice", "joe and the juice",
  "paul", "le pain quotidien", "eat.", "itsu", "leon",
  "nero", "cafe nero",
]);

const QUERY = `
[out:json][timeout:120];
node["amenity"="cafe"]["cuisine"~"coffee",i](${LONDON_BBOX});
out;
`;

function isChain(name) {
  const lower = name.toLowerCase().trim();
  for (const chain of CHAINS) {
    if (lower === chain || lower.startsWith(chain + " ") || lower.includes(chain)) {
      return true;
    }
  }
  return false;
}

async function main() {
  console.log("Scraping independent coffee shops in London...\n");

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
  console.log(`Overpass returned ${data.elements.length} cafes`);

  const seen = new Set();
  const features = [];

  for (const el of data.elements) {
    if (!el.lat || !el.lon) continue;
    const name = el.tags?.name;
    if (!name) continue;
    if (isChain(name)) continue;

    // Also skip if brand tag indicates a chain
    if (el.tags?.brand && isChain(el.tags.brand)) continue;

    const key = `${name}-${el.lat.toFixed(3)}-${el.lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [el.lon, el.lat] },
      properties: {
        name,
        address: [el.tags?.["addr:street"], el.tags?.["addr:housenumber"]]
          .filter(Boolean).join(" ") || "",
        postcode: el.tags?.["addr:postcode"] || "",
        website: el.tags?.website || "",
      },
    });
  }

  const geojson = { type: "FeatureCollection", features };
  writeFileSync(OUTPUT_PATH, JSON.stringify(geojson, null, 2));
  console.log(`Saved ${features.length} independent coffee shops to ${OUTPUT_PATH}`);
}

main().catch(console.error);
