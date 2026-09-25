#!/usr/bin/env node

/**
 * Scraper for dentists in London.
 * Uses the OpenStreetMap Overpass API.
 * Queries both amenity=dentist and healthcare=dentist tags (nodes + ways).
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writePointLayer } from "./lib/output.js";
import { overpassQuery } from "./lib/overpass.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/dentists.geojson");
const LONDON_BBOX = "51.28,-0.52,51.70,0.34";

const QUERY = `
[out:json][timeout:180];
(
  node["amenity"="dentist"](${LONDON_BBOX});
  way["amenity"="dentist"](${LONDON_BBOX});
  node["healthcare"="dentist"](${LONDON_BBOX});
  way["healthcare"="dentist"](${LONDON_BBOX});
);
out center;
`;

const NHS_RE = /\bnhs\b/i;

function isNhs(tags) {
  if (tags["healthcare:nhs"] === "yes") return true;
  return NHS_RE.test(tags.name || "") || NHS_RE.test(tags.operator || "");
}

async function main() {
  console.log("Scraping dentists in London...\n");

  const data = await overpassQuery(QUERY);
  console.log(`Overpass returned ${data.elements.length} elements`);

  const seen = new Set();
  const features = [];

  for (const el of data.elements) {
    const lat = el.lat || el.center?.lat;
    const lng = el.lon || el.center?.lon;
    if (!lat || !lng) continue;

    const tags = el.tags || {};
    const name = tags.name;
    if (!name) continue;

    const key = `${name}-${lat.toFixed(3)}-${lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        name,
        address: [tags["addr:street"], tags["addr:housenumber"]]
          .filter(Boolean).join(" ") || "",
        postcode: tags["addr:postcode"] || "",
        phone: tags.phone || tags["contact:phone"] || "",
        nhs: isNhs(tags),
      },
    });
  }

  const nhsCount = features.filter((f) => f.properties.nhs).length;
  writePointLayer(OUTPUT_PATH, features, { source: "OpenStreetMap via Overpass API", vintage: "OSM snapshot at generation date" });
  console.log(`Saved ${features.length} dentists (${nhsCount} flagged NHS) to ${OUTPUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
