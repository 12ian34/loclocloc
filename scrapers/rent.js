#!/usr/bin/env node

/**
 * Housing affordability at LSOA level for London.
 * Uses the English Indices of Deprivation 2019 — "Barriers to Housing and Services" sub-domain
 * and "Income Deprivation" domain scores, which give real LSOA-level variation.
 * Then calibrates against known borough median rents to produce estimated monthly rents.
 */

import * as fs from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

XLSX.set_fs(fs);
import { getLSOABoundaries, featureCentroid, distFromCenter } from "./lib/boundaries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/rent.geojson");
const IMD_CACHE = resolve(__dirname, "../public/data/_imd_scores.xlsx");

const IMD_URL = "https://assets.publishing.service.gov.uk/media/5d8b3b51ed915d036a455aa6/File_5_-_IoD2019_Scores.xlsx";

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
  console.log("Building rent choropleth with real IMD data...\n");

  // Download IMD scores
  if (!fs.existsSync(IMD_CACHE)) {
    console.log("Downloading IMD 2019 scores...");
    const res = await fetch(IMD_URL);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(IMD_CACHE, buf);
    console.log("Cached IMD data");
  } else {
    console.log("Using cached IMD data");
  }

  // Parse the Excel file
  const wb = XLSX.readFile(IMD_CACHE);
  const sheet = wb.Sheets["IoD2019 Scores"];
  const rows = XLSX.utils.sheet_to_json(sheet);

  // Build a map of LSOA code -> IMD data
  // The columns we want:
  // - "LSOA code (2011)" -> lsoa code
  // - "Income Score (rate)" -> income deprivation rate
  // - "Barriers to Housing and Services Score" -> housing barriers
  // - "Living Environment Score" -> living environment quality
  const imdData = new Map();
  for (const row of rows) {
    const code = row["LSOA code (2011)"];
    if (!code) continue;
    imdData.set(code, {
      income: row["Income Score (rate)"] || 0,
      barriers: row["Barriers to Housing and Services Score"] || 0,
      living: row["Living Environment Score"] || 0,
      imdScore: row["Index of Multiple Deprivation (IMD) Score"] || 0,
    });
  }
  console.log(`Parsed IMD data for ${imdData.size} LSOAs`);

  // We need a 2021 LSOA -> 2011 LSOA mapping since IMD uses 2011 codes
  // Our boundaries use 2021 codes. Many are the same, but some changed.
  // For those that don't match, we'll use centroid-based nearest neighbor.

  const lsoas = await getLSOABoundaries();

  // Collect all IMD income scores to compute percentile-based rent mapping
  const allIncomeScores = [...imdData.values()].map((d) => d.income).sort((a, b) => a - b);
  const allBarrierScores = [...imdData.values()].map((d) => d.barriers).sort((a, b) => a - b);

  // For each LSOA, try direct code match, then nearby match
  const centroidsForUnmatched = [];
  let matched = 0;

  for (const f of lsoas.features) {
    const code = f.properties.code;
    const imd = imdData.get(code);
    if (imd) {
      f.properties._imd = imd;
      matched++;
    } else {
      centroidsForUnmatched.push(f);
    }
  }

  console.log(`Direct code match: ${matched} / ${lsoas.features.length}`);

  // For unmatched 2021 LSOAs, find nearest 2011 LSOA by centroid
  if (centroidsForUnmatched.length > 0) {
    // Build centroid index for 2011 LSOAs from IMD data
    // We don't have 2011 boundaries, so just use borough average
    for (const f of centroidsForUnmatched) {
      const borough = f.properties.borough;
      // Find average IMD scores from matched LSOAs in same borough
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
  }

  // Now compute rent estimates using IMD + borough baseline
  // Lower income deprivation + higher barriers to housing = higher rent area
  for (const f of lsoas.features) {
    const imd = f.properties._imd;
    const boroughRent = matchBoroughRent(f.properties.borough);

    // Income deprivation rate: 0-0.6 (higher = more deprived = generally lower rent)
    // Barriers score: higher = harder to access housing = more expensive areas
    // We invert income (low deprivation = affluent = high rent)
    const affluenceFactor = 1 - (imd.income / 0.5); // normalize: 0=very deprived, 2=very affluent
    const barriersFactor = imd.barriers / 30; // normalize rough range

    // Blend: affluence drives rent up, barriers indicate housing pressure
    const adjustmentFactor = 0.7 + 0.3 * affluenceFactor + 0.1 * barriersFactor;

    const rent = Math.max(700, Math.round((boroughRent * adjustmentFactor) / 25) * 25);

    f.properties.value = rent;
    f.properties.metric = "est. rent £/month";
    f.properties.label = `${f.properties.name}: ~£${rent}/mo`;
    delete f.properties._imd;
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(lsoas));
  console.log(`\nSaved rent choropleth (${lsoas.features.length} LSOAs) to ${OUTPUT_PATH}`);
}

main().catch(console.error);
