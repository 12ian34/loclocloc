#!/usr/bin/env node

/**
 * Green space coverage at LSOA level for London.
 * Uses OpenStreetMap park/garden/greenspace polygons queried via Overpass,
 * then estimates coverage per LSOA using point sampling at LSOA centroids.
 *
 * Approach: count how many green space polygons are within/near each LSOA
 * centroid, weighted by proximity and area. This is a rough proxy for
 * actual % coverage but produces a useful comparative choropleth.
 *
 * For a more accurate approach, use OS Open Greenspace with Turf.js intersection.
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getLSOABoundaries, featureCentroid } from "./lib/boundaries.js";
import { overpassQuery } from "./lib/overpass.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/green-space.geojson");
/** 8 tiles — omit landuse=grass (too dense for Overpass in London) */
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
[out:json][timeout:120];
(
  way["leisure"="park"](${s});
  way["leisure"="garden"](${s});
  way["leisure"="nature_reserve"](${s});
  way["landuse"="recreation_ground"](${s});
  way["landuse"="village_green"](${s});
  relation["leisure"="park"](${s});
  relation["leisure"="nature_reserve"](${s});
);
out center;
`;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function main() {
  console.log("Building green space choropleth...\n");

  console.log(`Fetching green space polygons from Overpass (${BBOX_SHARDS.length} bbox shards)...`);
  const seenEl = new Set();
  const elements = [];
  for (let i = 0; i < BBOX_SHARDS.length; i++) {
    console.log(`  Shard ${i + 1}/${BBOX_SHARDS.length}...`);
    const data = await overpassQuery(queryForBbox(BBOX_SHARDS[i]));
    for (const el of data.elements || []) {
      const k = `${el.type}:${el.id}`;
      if (seenEl.has(k)) continue;
      seenEl.add(k);
      elements.push(el);
    }
    if (i < BBOX_SHARDS.length - 1) await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(`Overpass returned ${elements.length} green space elements (deduped)`);

  const greenPoints = [];
  for (const el of elements) {
    const lat = el.lat || el.center?.lat;
    const lng = el.lon || el.center?.lon;
    if (!lat || !lng) continue;
    greenPoints.push({ lat, lng });
  }
  console.log(`${greenPoints.length} green spaces with valid centers`);

  // Load LSOA boundaries
  const lsoas = await getLSOABoundaries();
  console.log(`Computing green space density for ${lsoas.features.length} LSOAs...`);

  // For each LSOA, count green spaces within radius and compute density score
  const RADIUS = 500; // meters
  const scores = [];

  for (const f of lsoas.features) {
    const c = featureCentroid(f);
    let count = 0;
    let weightedSum = 0;

    for (const gp of greenPoints) {
      const d = haversine(c.lat, c.lng, gp.lat, gp.lng);
      if (d <= RADIUS) {
        count++;
        weightedSum += (RADIUS - d) / RADIUS;
      }
    }

    scores.push(weightedSum);
    f.properties._rawScore = weightedSum;
  }

  // Normalize to 0-100 scale using percentile
  scores.sort((a, b) => a - b);
  for (const f of lsoas.features) {
    const raw = f.properties._rawScore;
    // Find percentile position
    let idx = 0;
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] <= raw) idx = i;
    }
    const pct = Math.round((idx / scores.length) * 100);
    f.properties.value = pct;
    f.properties.metric = "green space score";
    delete f.properties._rawScore;
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(lsoas));
  console.log(`Saved green space choropleth to ${OUTPUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
