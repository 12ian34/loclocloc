#!/usr/bin/env node

/**
 * Scraper for supermarkets in London.
 * Uses the OpenStreetMap Overpass API (shop=supermarket; nodes, ways and relations).
 * Big chains are normalised to a canonical `brand` so the client can group / colour by chain.
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writePointLayer } from "./lib/output.js";
import { overpassQuery } from "./lib/overpass.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/supermarkets.geojson");
const LONDON_BBOX = "51.28,-0.52,51.70,0.34";

const QUERY = `
[out:json][timeout:180];
(
  node["shop"="supermarket"](${LONDON_BBOX});
  way["shop"="supermarket"](${LONDON_BBOX});
  relation["shop"="supermarket"](${LONDON_BBOX});
);
out center;
`;

/** Canonical chain name → regex matched (case-insensitively) against `brand` then `name`. */
const CHAINS = [
  ["Tesco", /\btesco\b/i],
  ["Sainsbury's", /\bsainsbur/i],
  ["Asda", /\basda\b/i],
  ["Morrisons", /\bmorrison/i],
  ["Waitrose", /\bwaitrose\b/i],
  ["Aldi", /\baldi\b/i],
  ["Lidl", /\blidl\b/i],
  ["M&S", /\b(m\s*&\s*s|marks\s*(&|and)\s*spencer)\b/i],
  ["Co-op", /\b(co-?op(erative)?)\b/i],
  ["Iceland", /\biceland\b/i],
  ["Whole Foods", /\bwhole\s*foods?\b/i],
];

function canonicalChain(text) {
  if (!text) return "";
  for (const [chain, re] of CHAINS) if (re.test(text)) return chain;
  return "";
}

function deriveBrand(tags) {
  // Prefer the explicit brand tag; normalise it so "Tesco Express" / "Little Waitrose" collapse to one chain.
  return canonicalChain(tags.brand) || canonicalChain(tags.name) || tags.brand || "";
}

async function main() {
  console.log("Scraping supermarkets in London...\n");

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
        brand: deriveBrand(tags),
        address: [tags["addr:street"], tags["addr:housenumber"]]
          .filter(Boolean).join(" ") || "",
        postcode: tags["addr:postcode"] || "",
        opening_hours: tags.opening_hours || "",
      },
    });
  }

  const byBrand = {};
  for (const f of features) {
    const b = f.properties.brand || "(other / unbranded)";
    byBrand[b] = (byBrand[b] || 0) + 1;
  }
  console.log("Brand breakdown:");
  for (const [b, n] of Object.entries(byBrand).sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${b}`);

  writePointLayer(OUTPUT_PATH, features, { source: "OpenStreetMap via Overpass API", vintage: "OSM snapshot at generation date" });
  console.log(`Saved ${features.length} supermarkets to ${OUTPUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
