#!/usr/bin/env node

/**
 * Fixed broadband availability at LSOA level for London.
 * Source: Ofcom Connected Nations 2025 — fixed broadband coverage open data (OGL),
 *   file 202507_fixed_oa_coverage_r01.csv (2021 census Output Areas, snapshot 1 July 2025).
 * Output Areas nest exactly inside LSOA 2021, so OA rows are summed to LSOA using the ONS
 *   "OA (2021) to LSOA to MSOA to LAD (Dec 2021)" lookup (services1.arcgis.com, London LADs only).
 * value = % premises with gigabit-capable broadband (higher = better).
 * Extras: sfbb (% ≥30 Mbit/s), ufbb (% ≥100 Mbit/s). Full-fibre share and speeds are not
 *   published below local-authority level, so they are not included.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { writeAreaLayer } from "./lib/output.js";
import { getLSOABoundaries } from "./lib/boundaries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/broadband.json");
const CACHE_DIR = resolve(__dirname, "./.cache");
const ZIP_PATH = resolve(CACHE_DIR, "_ofcom-cn2025-fixed-coverage.zip");
const CSV_PATH = resolve(CACHE_DIR, "_ofcom-cn2025-fixed-oa-coverage.csv");
const LOOKUP_PATH = resolve(CACHE_DIR, "_oa21-lsoa21-london.json");

const RELEASE = "Connected Nations 2025 (snapshot 1 July 2025)";
const ZIP_URL =
  "https://www.ofcom.org.uk/siteassets/resources/documents/research-and-data/multi-sector/infrastructure-research/connected-nations-2025/202507_fixed_broadband_coverage_r01.zip";
const INNER_ZIP = "202507_fixed_coverage_r01/202507_fixed_oa_coverage_r01.zip";
const INNER_CSV = "202507_fixed_oa_coverage_r01/202507_fixed_oa_coverage_r01.csv";

const LOOKUP_URL =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/OA_LSOA_MSOA_EW_DEC_2021_LU_v3/FeatureServer/0/query";

// CSV header → property. Percentages are recomputed from premises counts (denominator: All Premises,
// matching Ofcom's own published percentages) so LSOA values are premises-weighted, not OA-averaged.
const COLS = {
  oa: "output_area",
  premises: "All Premises",
  gigabit: "Number of premises with Gigabit availability",
  sfbb: "Number of premises with SFBB availability",
  ufbb: "Number of premises with UFBB (100Mbit/s) availability",
};

async function fetchOACSV() {
  if (existsSync(CSV_PATH)) {
    console.log("Using cached Ofcom OA coverage CSV");
    return readFileSync(CSV_PATH, "utf-8");
  }
  mkdirSync(CACHE_DIR, { recursive: true });

  if (!existsSync(ZIP_PATH)) {
    console.log("Downloading Ofcom fixed broadband coverage zip (~35 MB)...");
    const res = await fetch(ZIP_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Ofcom zip returned HTTP ${res.status}`);
    writeFileSync(ZIP_PATH, Buffer.from(await res.arrayBuffer()));
    console.log("Cached zip");
  }

  console.log("Extracting output-area CSV (nested zip)...");
  const inner = execFileSync("unzip", ["-p", ZIP_PATH, INNER_ZIP], { maxBuffer: 256 * 1024 * 1024 });
  const innerPath = resolve(CACHE_DIR, "_ofcom-cn2025-fixed-oa-coverage.zip");
  writeFileSync(innerPath, inner);
  const csv = execFileSync("unzip", ["-p", innerPath, INNER_CSV], { maxBuffer: 256 * 1024 * 1024 }).toString("utf-8");
  writeFileSync(CSV_PATH, csv);
  console.log("Cached CSV");
  return csv;
}

async function fetchOALookup() {
  if (existsSync(LOOKUP_PATH)) {
    console.log("Using cached OA21 → LSOA21 lookup");
    return JSON.parse(readFileSync(LOOKUP_PATH, "utf-8"));
  }

  console.log("Fetching ONS OA21 → LSOA21 lookup for London...");
  const lookup = {};
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({
      where: "LAD22CD LIKE 'E09%'",
      outFields: "OA21CD,LSOA21CD",
      orderByFields: "OA21CD",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      returnGeometry: "false",
      f: "json",
    });
    const res = await fetch(`${LOOKUP_URL}?${params}`);
    if (!res.ok) throw new Error(`OA lookup returned HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`OA lookup error: ${JSON.stringify(data.error)}`);
    for (const f of data.features || []) lookup[f.attributes.OA21CD] = f.attributes.LSOA21CD;
    if (!data.exceededTransferLimit || !data.features?.length) break;
    if (offset % 5000 === 0) console.log(`  ${Object.keys(lookup).length} OAs so far`);
  }
  const n = Object.keys(lookup).length;
  if (n < 20000) throw new Error(`Only ${n} London OAs in lookup, expected ~26k`);
  writeFileSync(LOOKUP_PATH, JSON.stringify(lookup));
  console.log(`Cached ${n} London OAs`);
  return lookup;
}

// Minimal CSV line splitter honouring double-quoted fields.
function splitCSV(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function aggregateToLSOA(csv, oaToLsoa) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = splitCSV(lines[0]).map((h) => h.trim());
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, name]) => [k, header.indexOf(name)]));
  const missing = Object.entries(idx).filter(([, i]) => i < 0).map(([k]) => COLS[k]);
  if (missing.length) throw new Error(`Unexpected Ofcom CSV header — missing: ${missing.join("; ")}`);

  const totals = new Map(); // lsoa → { premises, gigabit, sfbb, ufbb, oas }
  let londonOAs = 0;
  for (let li = 1; li < lines.length; li++) {
    const parts = splitCSV(lines[li]);
    const oa = parts[idx.oa]?.trim();
    const lsoa = oaToLsoa[oa];
    if (!lsoa) continue;
    londonOAs++;
    const t = totals.get(lsoa) || { premises: 0, gigabit: 0, sfbb: 0, ufbb: 0, oas: 0 };
    for (const k of ["premises", "gigabit", "sfbb", "ufbb"]) {
      const v = parseFloat(parts[idx[k]]);
      if (Number.isFinite(v)) t[k] += v;
    }
    t.oas++;
    totals.set(lsoa, t);
  }
  console.log(`Matched ${londonOAs} London OAs → ${totals.size} LSOAs`);

  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
  const result = new Map();
  for (const [lsoa, t] of totals) {
    if (t.premises <= 0) continue;
    result.set(lsoa, { value: pct(t.gigabit, t.premises), sfbb: pct(t.sfbb, t.premises), ufbb: pct(t.ufbb, t.premises) });
  }
  return result;
}

async function main() {
  console.log("Building fixed broadband availability choropleth...\n");

  const [csv, oaToLsoa] = await Promise.all([fetchOACSV(), fetchOALookup()]);
  const byLSOA = aggregateToLSOA(csv, oaToLsoa);

  const lsoas = await getLSOABoundaries();
  const KEYS = ["value", "sfbb", "ufbb"];

  const boroughSums = {};
  for (const f of lsoas.features) {
    const v = byLSOA.get(f.properties.code);
    if (!v) continue;
    const b = f.properties.borough;
    const s = (boroughSums[b] ||= { n: 0, value: 0, sfbb: 0, ufbb: 0 });
    s.n++;
    for (const k of KEYS) s[k] += v[k];
  }

  let matched = 0;
  let fallback = 0;
  for (const f of lsoas.features) {
    let v = byLSOA.get(f.properties.code);
    if (v) matched++;
    else {
      fallback++;
      const s = boroughSums[f.properties.borough];
      v = Object.fromEntries(KEYS.map((k) => [k, s?.n ? Math.round((s[k] / s.n) * 10) / 10 : 0]));
    }
    for (const k of KEYS) f.properties[k] = v[k];
    f.properties.metric = "% premises with gigabit-capable broadband";
  }

  console.log(`Matched ${matched} / ${lsoas.features.length} LSOAs directly; ${fallback} filled from borough mean`);

  const sorted = lsoas.features.map((f) => f.properties.value).sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  console.log(`Gigabit %: min ${sorted[0]}, p10 ${q(0.1)}, p25 ${q(0.25)}, median ${q(0.5)}, p75 ${q(0.75)}, p90 ${q(0.9)}, max ${sorted[sorted.length - 1]}`);

  writeAreaLayer(OUTPUT_PATH, lsoas, {
    properties: KEYS,
    source: "Ofcom Connected Nations 2025 fixed broadband coverage (output-area file, OGL) summed to LSOA 2021 via ONS OA21→LSOA21 lookup; value = % premises gigabit-capable",
    vintage: RELEASE,
  });
  console.log(`Saved broadband choropleth to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
