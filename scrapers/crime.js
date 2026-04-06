#!/usr/bin/env node

/**
 * Real crime data at LSOA level for London.
 * Queries data.police.uk street-level crimes across a dense grid,
 * then assigns each crime to the nearest LSOA centroid (avoids
 * the police snap-point issue where strict point-in-polygon leaves gaps).
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getLSOABoundaries, featureCentroid } from "./lib/boundaries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/crime.geojson");

// Dense grid across London — 0.012° lat (~1.3km), 0.015° lng (~1km)
// Each API call returns crimes within ~1 mile (~1.6km), so good overlap
const GRID_POINTS = [];
for (let lat = 51.30; lat <= 51.68; lat += 0.012) {
  for (let lng = -0.50; lng <= 0.32; lng += 0.015) {
    GRID_POINTS.push({
      lat: Math.round(lat * 10000) / 10000,
      lng: Math.round(lng * 10000) / 10000,
    });
  }
}

async function fetchCrimes(lat, lng, date) {
  const url = `https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}&date=${date}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("Fetching real crime data from data.police.uk...\n");

  const datesRes = await fetch("https://data.police.uk/api/crimes-street-dates");
  const dates = await datesRes.json();
  const latestDate = dates[0].date;
  console.log(`Using date: ${latestDate}`);
  console.log(`Query grid: ${GRID_POINTS.length} points (dense coverage)\n`);

  // Fetch crimes
  const allCrimes = new Map();
  const BATCH_SIZE = 15;

  for (let i = 0; i < GRID_POINTS.length; i += BATCH_SIZE) {
    const batch = GRID_POINTS.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((p) => fetchCrimes(p.lat, p.lng, latestDate))
    );
    for (const crimes of results) {
      for (const c of crimes) {
        if (c.id && !allCrimes.has(c.id)) {
          allCrimes.set(c.id, c);
        }
      }
    }
    if (i % (BATCH_SIZE * 10) === 0) {
      console.log(`  Grid ${Math.min(i + BATCH_SIZE, GRID_POINTS.length)}/${GRID_POINTS.length}: ${allCrimes.size} unique crimes`);
    }
    await sleep(700);
  }

  console.log(`\nTotal unique crimes: ${allCrimes.size}`);

  // Load LSOA boundaries and precompute centroids
  const lsoas = await getLSOABoundaries();

  console.log(`\nAssigning crimes to ${lsoas.features.length} LSOAs by nearest centroid...`);

  const centroids = lsoas.features.map((f) => {
    const c = featureCentroid(f);
    return { code: f.properties.code, lat: c.lat, lng: c.lng };
  });

  // Build spatial grid index for centroids (0.005° cells ≈ 500m)
  const CELL_SIZE = 0.005;
  const centroidIndex = new Map();
  for (const c of centroids) {
    const key = `${Math.floor(c.lat / CELL_SIZE)}_${Math.floor(c.lng / CELL_SIZE)}`;
    if (!centroidIndex.has(key)) centroidIndex.set(key, []);
    centroidIndex.get(key).push(c);
  }

  // Assign each crime to nearest LSOA centroid
  const crimeCounts = {};
  for (const f of lsoas.features) crimeCounts[f.properties.code] = 0;

  let assigned = 0;
  for (const crime of allCrimes.values()) {
    const lat = parseFloat(crime.location.latitude);
    const lng = parseFloat(crime.location.longitude);
    const gx = Math.floor(lat / CELL_SIZE);
    const gy = Math.floor(lng / CELL_SIZE);

    let bestDist = Infinity;
    let bestCode = null;

    // Search 3x3 grid around the crime point
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${gx + dx}_${gy + dy}`;
        const candidates = centroidIndex.get(key);
        if (!candidates) continue;
        for (const c of candidates) {
          const d = (lat - c.lat) ** 2 + (lng - c.lng) ** 2;
          if (d < bestDist) {
            bestDist = d;
            bestCode = c.code;
          }
        }
      }
    }

    if (bestCode) {
      crimeCounts[bestCode]++;
      assigned++;
    }
  }

  console.log(`Assigned ${assigned} / ${allCrimes.size} crimes to LSOAs`);

  // Check coverage
  const withCrime = Object.values(crimeCounts).filter((v) => v > 0).length;
  console.log(`LSOAs with >0 crimes: ${withCrime} / ${lsoas.features.length}`);

  for (const f of lsoas.features) {
    const count = crimeCounts[f.properties.code] || 0;
    f.properties.value = count;
    f.properties.metric = "crimes (monthly)";
    f.properties.label = `${f.properties.name}: ${count} crimes`;
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(lsoas));
  console.log(`\nSaved crime choropleth (${lsoas.features.length} LSOAs) to ${OUTPUT_PATH}`);
}

main().catch(console.error);
