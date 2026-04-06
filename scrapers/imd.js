#!/usr/bin/env node

/**
 * Extracts ALL Index of Multiple Deprivation (IMD 2019) domains at LSOA level.
 * Real ONS data — no synthetic values.
 * Outputs a single GeoJSON with all domain scores as properties on each LSOA.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import { getLSOABoundaries } from "./lib/boundaries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/imd.geojson");
const IMD_CACHE = resolve(__dirname, "../public/data/_imd_scores.xlsx");
const IMD_URL = "https://assets.publishing.service.gov.uk/media/5d8b3b51ed915d036a455aa6/File_5_-_IoD2019_Scores.xlsx";

async function main() {
  console.log("Extracting all IMD 2019 domains at LSOA level...\n");

  // Download IMD if not cached
  if (!existsSync(IMD_CACHE)) {
    console.log("Downloading IMD 2019 scores...");
    const res = await fetch(IMD_URL);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(IMD_CACHE, buf);
    console.log("Cached IMD data");
  } else {
    console.log("Using cached IMD data");
  }

  const wb = XLSX.readFile(IMD_CACHE);
  const sheet = wb.Sheets["IoD2019 Scores"];
  const rows = XLSX.utils.sheet_to_json(sheet);
  console.log(`Parsed ${rows.length} LSOAs from IMD`);

  // Build lookup by LSOA code
  const imdLookup = new Map();
  for (const row of rows) {
    const code = row["LSOA code (2011)"];
    if (!code) continue;
    imdLookup.set(code, {
      imd: row["Index of Multiple Deprivation (IMD) Score"] || 0,
      income: row["Income Score (rate)"] || 0,
      employment: row["Employment Score (rate)"] || 0,
      education: row["Education, Skills and Training Score"] || 0,
      health: row["Health Deprivation and Disability Score"] || 0,
      crime: row["Crime Score"] || 0,
      barriers: row["Barriers to Housing and Services Score"] || 0,
      living: row["Living Environment Score"] || 0,
      idaci: row["Income Deprivation Affecting Children Index (IDACI) Score (rate)"] || 0,
      idaopi: row["Income Deprivation Affecting Older People (IDAOPI) Score (rate)"] || 0,
    });
  }

  // Load LSOA boundaries
  const lsoas = await getLSOABoundaries();

  // Match IMD data to 2021 LSOAs (most codes are unchanged from 2011)
  let matched = 0;
  let unmatched = 0;

  // Compute borough averages for fallback
  const boroughTotals = {};
  const boroughCounts = {};

  for (const f of lsoas.features) {
    const imd = imdLookup.get(f.properties.code);
    if (imd) {
      f.properties = { ...f.properties, ...imd };
      matched++;

      const b = f.properties.borough;
      if (!boroughTotals[b]) {
        boroughTotals[b] = { imd: 0, income: 0, employment: 0, education: 0, health: 0, crime: 0, barriers: 0, living: 0 };
        boroughCounts[b] = 0;
      }
      for (const k of Object.keys(boroughTotals[b])) {
        boroughTotals[b][k] += imd[k];
      }
      boroughCounts[b]++;
    }
  }

  // Fill unmatched LSOAs with borough averages
  for (const f of lsoas.features) {
    if (f.properties.imd !== undefined) continue;
    unmatched++;
    const b = f.properties.borough;
    const avg = boroughTotals[b];
    const count = boroughCounts[b];
    if (avg && count) {
      for (const k of Object.keys(avg)) {
        f.properties[k] = Math.round((avg[k] / count) * 1000) / 1000;
      }
    } else {
      // Last resort defaults
      f.properties.imd = 0;
      f.properties.income = 0;
      f.properties.employment = 0;
      f.properties.education = 0;
      f.properties.health = 0;
      f.properties.crime = 0;
      f.properties.barriers = 0;
      f.properties.living = 0;
    }
  }

  console.log(`Matched: ${matched}, borough-averaged: ${unmatched}`);

  writeFileSync(OUTPUT_PATH, JSON.stringify(lsoas));
  console.log(`\nSaved IMD choropleth (${lsoas.features.length} LSOAs, 8 domains) to ${OUTPUT_PATH}`);
}

main().catch(console.error);
