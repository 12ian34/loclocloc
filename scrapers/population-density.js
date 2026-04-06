#!/usr/bin/env node

/**
 * Population density at LSOA level for London.
 * Source: ONS Census 2021 — TS006 (usual residents per km²).
 * UK Data Service hosts the official LSOA table as XLSX; joined to London LSOA boundaries.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import { getLSOABoundaries } from "./lib/boundaries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/population-density.geojson");
const CACHE_PATH = resolve(__dirname, "../public/data/_population-density-ts006.xlsx");

const DATA_URL =
  "https://ukds-ckan.s3.eu-west-1.amazonaws.com/2021/ONS/release1/Unrounded-Population-Estimates/Population-Density/TS006-Population-Density-2021-lsoa-ONS.xlsx";

const CODE_COL = "Lower Layer Super Output Areas Code";
const VAL_COL = "Observation";

async function fetchData() {
  if (existsSync(CACHE_PATH)) {
    console.log("Using cached TS006 population density XLSX");
    return readFileSync(CACHE_PATH);
  }

  console.log("Downloading Census 2021 TS006 (LSOA) from UK Data Service mirror...");
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Download returned HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(CACHE_PATH, buf);
  console.log("Cached XLSX");
  return buf;
}

function parseXlsx(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets.Dataset || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  const lookup = new Map();
  for (const row of rows) {
    const code = row[CODE_COL];
    const raw = row[VAL_COL];
    if (!code || raw == null || raw === "") continue;
    const value = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    lookup.set(String(code).trim(), Math.round(value));
  }
  return lookup;
}

async function main() {
  console.log("Building population density choropleth...\n");

  const buf = await fetchData();
  const densityLookup = parseXlsx(buf);
  console.log(`Parsed ${densityLookup.size} LSOA density values`);

  const lsoas = await getLSOABoundaries();
  let matched = 0;

  for (const f of lsoas.features) {
    const density = densityLookup.get(f.properties.code);
    if (density != null) {
      f.properties.value = density;
      matched++;
    } else {
      f.properties.value = 0;
    }
    f.properties.metric = "persons/km²";
  }

  console.log(`Matched ${matched} / ${lsoas.features.length} LSOAs`);

  writeFileSync(OUTPUT_PATH, JSON.stringify(lsoas));
  console.log(`Saved population density choropleth to ${OUTPUT_PATH}`);
}

main().catch(console.error);
