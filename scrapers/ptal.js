#!/usr/bin/env node

/**
 * PTAL-related accessibility at LSOA level for London.
 * Source: TfL "LSOA aggregated PTAL stats 2023" (CSV on ArcGIS Hub).
 * Uses mean access index (mean_AI) — numeric precursor to PTAL bands; higher = better access.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getLSOABoundaries } from "./lib/boundaries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/ptal.geojson");
const CACHE_PATH = resolve(__dirname, "../public/data/_ptal-lsoa-2023.csv");

const DATA_URL =
  "https://www.arcgis.com/sharing/rest/content/items/3eb38b75667a49df9ef1240e9a197615/data";

async function fetchCSV() {
  if (existsSync(CACHE_PATH)) {
    console.log("Using cached PTAL LSOA CSV");
    return readFileSync(CACHE_PATH, "utf-8");
  }

  console.log("Downloading TfL LSOA PTAL stats CSV...");
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`PTAL CSV returned HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(CACHE_PATH, text);
  console.log("Cached CSV");
  return text;
}

function parseCSV(text) {
  const lookup = new Map();
  const lines = text.trim().split("\n");
  if (lines.length < 2) return lookup;

  const header = lines[0].split(",");
  const iCode = header.indexOf("LSOA21CD");
  const iMean = header.indexOf("mean_AI");
  if (iCode < 0 || iMean < 0) {
    throw new Error("Unexpected PTAL CSV header — expected LSOA21CD and mean_AI");
  }

  for (let li = 1; li < lines.length; li++) {
    const parts = lines[li].split(",");
    if (parts.length <= Math.max(iCode, iMean)) continue;
    const code = parts[iCode]?.trim();
    const raw = parts[iMean]?.trim();
    if (!code?.startsWith("E")) continue;
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) continue;
    lookup.set(code, Math.round(v * 10) / 10);
  }
  return lookup;
}

async function main() {
  console.log("Building PTAL / access index choropleth...\n");

  const csv = await fetchCSV();
  const ptalLookup = parseCSV(csv);
  console.log(`Parsed ${ptalLookup.size} LSOA access-index values`);

  const lsoas = await getLSOABoundaries();
  let matched = 0;

  const boroughTotals = {};
  const boroughCounts = {};
  for (const f of lsoas.features) {
    const val = ptalLookup.get(f.properties.code);
    if (val != null) {
      const b = f.properties.borough;
      boroughTotals[b] = (boroughTotals[b] || 0) + val;
      boroughCounts[b] = (boroughCounts[b] || 0) + 1;
    }
  }

  for (const f of lsoas.features) {
    let val = ptalLookup.get(f.properties.code);
    if (val != null) matched++;
    else {
      const b = f.properties.borough;
      val = boroughCounts[b] ? Math.round((boroughTotals[b] / boroughCounts[b]) * 10) / 10 : 0;
    }
    f.properties.value = val;
    f.properties.metric = "mean access index";
  }

  console.log(`Matched ${matched} / ${lsoas.features.length} LSOAs directly`);

  writeFileSync(OUTPUT_PATH, JSON.stringify(lsoas));
  console.log(`Saved PTAL choropleth to ${OUTPUT_PATH}`);
}

main().catch(console.error);
