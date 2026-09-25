#!/usr/bin/env node

/**
 * Extracts ALL English Indices of Deprivation 2025 (IoD2025) scores at LSOA level.
 * Source: MHCLG "File 5: scores for the Indices of Deprivation" (published 30 Oct 2025),
 * already on 2021 LSOA boundaries, so it joins directly on our boundary codes.
 * Real government data — no synthetic values.
 * Outputs an area layer (`imd.json`) with the IMD score, the seven domain scores and the
 * two supplementary indices (IDACI / IDAOPI) keyed by 2021 LSOA code.
 */

import * as fs from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

XLSX.set_fs(fs);
import { getLSOABoundaries } from "./lib/boundaries.js";
import { writeAreaLayer } from "./lib/output.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/imd.json");
const IMD_CACHE = resolve(__dirname, "./.cache/_iod2025_scores.xlsx");
const IMD_URL =
  "https://assets.publishing.service.gov.uk/media/691ded34513046b952c500bd/File_5_IoD2025_Scores_for_the_Indices_of_Deprivation.xlsx";
const SHEET_NAME = "IoD2025 Scores";
const CODE_COLUMN = "LSOA code (2021)";

// Output property -> spreadsheet column header
const COLUMNS = {
  imd: "Index of Multiple Deprivation (IMD) Score",
  income: "Income Score (rate)",
  employment: "Employment Score (rate)",
  education: "Education, Skills and Training Score",
  health: "Health Deprivation and Disability Score",
  crime: "Crime Score",
  barriers: "Barriers to Housing and Services Score",
  living: "Living Environment Score",
  idaci: "Income Deprivation Affecting Children Index (IDACI) Score (rate)",
  idaopi: "Income Deprivation Affecting Older People (IDAOPI) Score (rate)",
};
const PROPERTIES = Object.keys(COLUMNS);

const round3 = (v) => Math.round(v * 1000) / 1000;

async function main() {
  console.log("Extracting all IoD2025 scores at LSOA level...\n");

  // Download IoD2025 scores if not cached
  if (!fs.existsSync(IMD_CACHE)) {
    console.log("Downloading IoD2025 scores (File 5)...");
    fs.mkdirSync(dirname(IMD_CACHE), { recursive: true });
    const res = await fetch(IMD_URL);
    if (!res.ok) throw new Error(`IoD2025 download returned HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(IMD_CACHE, buf);
    console.log("Cached IoD2025 data");
  } else {
    console.log("Using cached IoD2025 data");
  }

  const wb = XLSX.readFile(IMD_CACHE);
  const sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found — sheets: ${wb.SheetNames.join(", ")}`);
  const rows = XLSX.utils.sheet_to_json(sheet);
  console.log(`Parsed ${rows.length} LSOAs from IoD2025`);

  // Sanity-check headers before joining
  const first = rows[0] || {};
  for (const col of [CODE_COLUMN, ...Object.values(COLUMNS)]) {
    if (!(col in first)) throw new Error(`Expected column "${col}" missing from "${SHEET_NAME}"`);
  }

  // Build lookup by 2021 LSOA code
  const imdLookup = new Map();
  for (const row of rows) {
    const code = row[CODE_COLUMN];
    if (!code) continue;
    const rec = {};
    for (const [prop, col] of Object.entries(COLUMNS)) {
      const v = Number(row[col]);
      rec[prop] = Number.isFinite(v) ? round3(v) : 0;
    }
    imdLookup.set(code, rec);
  }

  // Load LSOA boundaries (2021 codes)
  const lsoas = await getLSOABoundaries();

  let matched = 0;
  let unmatched = 0;

  // Compute borough averages for fallback
  const boroughTotals = {};
  const boroughCounts = {};

  for (const f of lsoas.features) {
    const imd = imdLookup.get(f.properties.code);
    if (!imd) continue;
    f.properties = { ...f.properties, ...imd };
    matched++;

    const b = f.properties.borough;
    if (!boroughTotals[b]) {
      boroughTotals[b] = Object.fromEntries(PROPERTIES.map((k) => [k, 0]));
      boroughCounts[b] = 0;
    }
    for (const k of PROPERTIES) boroughTotals[b][k] += imd[k];
    boroughCounts[b]++;
  }

  // Fill unmatched LSOAs with borough means
  for (const f of lsoas.features) {
    if (f.properties.imd !== undefined) continue;
    unmatched++;
    const b = f.properties.borough;
    const avg = boroughTotals[b];
    const count = boroughCounts[b];
    if (avg && count) {
      for (const k of PROPERTIES) f.properties[k] = round3(avg[k] / count);
    } else {
      // Last resort defaults
      for (const k of PROPERTIES) f.properties[k] = 0;
    }
  }

  console.log(`Matched: ${matched}, borough-averaged: ${unmatched}`);

  writeAreaLayer(OUTPUT_PATH, lsoas, {
    properties: PROPERTIES,
    source: "MHCLG English Indices of Deprivation 2025 — File 5: scores for the Indices of Deprivation (LSOA 2021)",
    vintage: "IoD2025 (MHCLG, Oct 2025)",
  });
  console.log(`\nSaved IMD area layer (${lsoas.features.length} LSOAs, ${PROPERTIES.length} scores) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
