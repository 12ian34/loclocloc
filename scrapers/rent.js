#!/usr/bin/env node

/**
 * Housing affordability at LSOA level for London.
 * Uses the English Indices of Deprivation 2025 (IoD2025, on 2021 LSOA boundaries) —
 * "Income Deprivation" domain and "Barriers to Housing and Services" domain scores,
 * which give real LSOA-level variation.
 * Then calibrates against known borough median rents to produce estimated monthly rents.
 * Modelled figures — not official rents or listings.
 */

import * as fs from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

XLSX.set_fs(fs);
import { getLSOABoundaries } from "./lib/boundaries.js";
import { writeAreaLayer } from "./lib/output.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/rent.json");
const IMD_CACHE = resolve(__dirname, "./.cache/_iod2025_scores.xlsx");

const IMD_URL =
  "https://assets.publishing.service.gov.uk/media/691ded34513046b952c500bd/File_5_IoD2025_Scores_for_the_Indices_of_Deprivation.xlsx";
const SHEET_NAME = "IoD2025 Scores";
const CODE_COLUMN = "LSOA code (2021)";

// Known borough median 1-bed rents (£/month, 2024)
const BOROUGH_RENT = {
  "City of London": 1950, "Westminster": 2100, "Camden": 1850,
  "Hackney": 1700, "Tower Hamlets": 1800, "Islington": 1800,
  "Southwark": 1650, "Lambeth": 1550, "Lewisham": 1350,
  "Greenwich": 1400, "Newham": 1450, "Haringey": 1500,
  "Waltham Forest": 1350, "Redbridge": 1250, "Havering": 1150,
  "Barking and Dagenham": 1200, "Bexley": 1100, "Bromley": 1200,
  "Croydon": 1200, "Sutton": 1150, "Merton": 1400,
  "Kingston upon Thames": 1350, "Richmond upon Thames": 1550,
  "Wandsworth": 1650, "Hammersmith and Fulham": 1800,
  "Kensington and Chelsea": 2300, "Ealing": 1400,
  "Hounslow": 1350, "Hillingdon": 1250, "Harrow": 1250,
  "Brent": 1400, "Barnet": 1350, "Enfield": 1250,
};

function matchBoroughRent(name) {
  if (!name) return 1300;
  if (BOROUGH_RENT[name] !== undefined) return BOROUGH_RENT[name];
  for (const [key, val] of Object.entries(BOROUGH_RENT)) {
    if (name.includes(key) || key.includes(name)) return val;
  }
  return 1300;
}

async function main() {
  console.log("Building rent choropleth with real IoD2025 data...\n");

  // Download IoD2025 scores (shared cache with scrapers/imd.js)
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

  // Parse the Excel file
  const wb = XLSX.readFile(IMD_CACHE);
  const sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found — sheets: ${wb.SheetNames.join(", ")}`);
  const rows = XLSX.utils.sheet_to_json(sheet);

  // Build a map of 2021 LSOA code -> IoD2025 data
  // The columns we want:
  // - "LSOA code (2021)" -> lsoa code
  // - "Income Score (rate)" -> income deprivation rate
  // - "Barriers to Housing and Services Score" -> housing barriers
  // - "Living Environment Score" -> living environment quality
  const imdData = new Map();
  for (const row of rows) {
    const code = row[CODE_COLUMN];
    if (!code) continue;
    imdData.set(code, {
      income: row["Income Score (rate)"] || 0,
      barriers: row["Barriers to Housing and Services Score"] || 0,
      living: row["Living Environment Score"] || 0,
      imdScore: row["Index of Multiple Deprivation (IMD) Score"] || 0,
    });
  }
  console.log(`Parsed IoD2025 data for ${imdData.size} LSOAs`);

  // IoD2025 is published on 2021 LSOA boundaries, the same as ours, so codes match directly.
  const lsoas = await getLSOABoundaries();

  const unmatched = [];
  let matched = 0;

  for (const f of lsoas.features) {
    const imd = imdData.get(f.properties.code);
    if (imd) {
      f.properties._imd = imd;
      matched++;
    } else {
      unmatched.push(f);
    }
  }

  console.log(`Direct code match: ${matched} / ${lsoas.features.length}`);

  // Safety net: any LSOA missing from the spreadsheet takes its borough average
  if (unmatched.length > 0) {
    for (const f of unmatched) {
      const borough = f.properties.borough;
      const boroughLSOAs = lsoas.features.filter(
        (g) => g.properties.borough === borough && g.properties._imd
      );
      if (boroughLSOAs.length > 0) {
        const avgIncome = boroughLSOAs.reduce((s, g) => s + g.properties._imd.income, 0) / boroughLSOAs.length;
        const avgBarriers = boroughLSOAs.reduce((s, g) => s + g.properties._imd.barriers, 0) / boroughLSOAs.length;
        f.properties._imd = { income: avgIncome, barriers: avgBarriers, living: 0 };
      } else {
        f.properties._imd = { income: 0.15, barriers: 0, living: 0 };
      }
    }
    console.log(`Borough-averaged: ${unmatched.length}`);
  }

  // Now compute rent estimates using IoD2025 + borough baseline
  // Lower income deprivation + higher barriers to housing = higher rent area
  for (const f of lsoas.features) {
    const imd = f.properties._imd;
    const boroughRent = matchBoroughRent(f.properties.borough);

    // Income deprivation rate: 0-0.6 (higher = more deprived = generally lower rent)
    // Barriers score: higher = harder to access housing = more expensive areas
    // We invert income (low deprivation = affluent = high rent)
    // IoD2025 income rates run up to ~1.0 in a handful of LSOAs; clamp so the affluence term stays in [-0, 1].
    const affluenceFactor = 1 - (Math.min(imd.income, 0.5) / 0.5); // normalize: 0=very deprived, 2=very affluent
    const barriersFactor = imd.barriers / 30; // normalize rough range

    // Blend: affluence drives rent up, barriers indicate housing pressure
    const adjustmentFactor = 0.7 + 0.3 * affluenceFactor + 0.1 * barriersFactor;

    const rent = Math.max(700, Math.round((boroughRent * adjustmentFactor) / 25) * 25);

    f.properties.value = rent;
    f.properties.metric = "est. rent £/month";
    delete f.properties._imd;
  }

  writeAreaLayer(OUTPUT_PATH, lsoas, {
    properties: ["value"],
    source: "Modelled in scrapers/rent.js from IoD2025 income / housing-barriers scores (MHCLG, Oct 2025) + hand-tuned borough anchor rents — indicative £/month, not official rents",
    vintage: "IoD2025 (MHCLG, Oct 2025) + 2024 borough anchors",
  });
  console.log(`\nSaved rent area layer (${lsoas.features.length} LSOAs) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
