#!/usr/bin/env node

/**
 * Public libraries in Greater London from OpenStreetMap (Overpass).
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/libraries.geojson");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const LONDON_BBOX = "51.28,-0.52,51.70,0.34";

const QUERY = `
[out:json][timeout:180];
node["amenity"="library"](${LONDON_BBOX});
out;
`;

async function main() {
  console.log("Fetching libraries from Overpass…\n");

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
  const seen = new Set();
  const features = [];

  for (const el of data.elements || []) {
    if (!el.lat || !el.lon) continue;
    const name = el.tags?.name || "Library";
    const key = `${name}-${el.lat.toFixed(4)}-${el.lon.toFixed(4)}`;
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
  console.log(`Saved ${features.length} libraries to ${OUTPUT_PATH}`);
}

main().catch(console.error);
