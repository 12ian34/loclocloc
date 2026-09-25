#!/usr/bin/env node

/**
 * Median house sale price at LSOA level for London.
 * Source: ONS "House Price Statistics for Small Areas" (HPSSA) Dataset 46 — median price paid
 * for residential properties by LSOA, all property types, rolling 12-month periods, built from
 * HM Land Registry price paid data. The current edition (released 20 Sept 2023, next release
 * "to be announced") runs to year ending Mar 2023 and is on 2011 LSOA codes, so values are
 * mapped to 2021 LSOAs via the ONS LSOA11→LSOA21 lookup: unchanged codes join directly, split
 * children inherit the 2011 parent value, merged areas take the mean of their 2011 parents.
 * LSOAs suppressed for too few sales (":") fall back to the most recent earlier period with a
 * value (up to MAX_FALLBACK_QUARTERS back), then to the borough median.
 */

import * as fs from "fs";
import { inflateRawSync } from "zlib";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

XLSX.set_fs(fs);
import { writeAreaLayer } from "./lib/output.js";
import { getLSOABoundaries } from "./lib/boundaries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/house-prices.json");
const ZIP_CACHE = resolve(__dirname, "./.cache/_hpssa46.zip");
const XLS_CACHE = resolve(__dirname, "./.cache/_hpssa46-median-price-lsoa.xls");
const LOOKUP_CACHE = resolve(__dirname, "./.cache/_lsoa11-lsoa21-london.json");

const DATA_URL =
  "https://www.ons.gov.uk/file?uri=/peoplepopulationandcommunity/housing/datasets/medianpricepaidbylowerlayersuperoutputareahpssadataset46/current/hpssadataset46medianpricepaidforresidentialpropertiesbylsoa.zip";
const SHEET_NAME = "1a";
const LAD_COL = "Local authority code";
const CODE_COL = "LSOA code";
const NAME_COL = "LSOA name";
// Suppressed LSOAs may only have a value many years back; beyond this the borough median is less misleading.
const MAX_FALLBACK_QUARTERS = 12;

// ONS Open Geography: LSOA (2011) to LSOA (2021) to LAD (2022) lookup, England & Wales
const LOOKUP_URL =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LSOA11_LSOA21_LAD22_EW_LU_v5/FeatureServer/0/query";

/** Pull the first entry with the given extension out of a (non-zip64) zip buffer. */
function extractZipEntry(zip, ext) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Download is not a zip archive");
  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let e = 0; e < entries; e++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt zip central directory");
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOff = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.toLowerCase().endsWith(ext)) continue;
    const start = localOff + 30 + zip.readUInt16LE(localOff + 26) + zip.readUInt16LE(localOff + 28);
    const data = zip.subarray(start, start + compSize);
    if (method === 0) return { name, data: Buffer.from(data) };
    if (method === 8) return { name, data: inflateRawSync(data) };
    throw new Error(`Unsupported zip compression method ${method}`);
  }
  throw new Error(`No ${ext} entry found in zip`);
}

async function fetchXls() {
  if (fs.existsSync(XLS_CACHE)) {
    console.log("Using cached HPSSA 46 XLS");
    return XLS_CACHE;
  }
  let zip;
  if (fs.existsSync(ZIP_CACHE)) {
    console.log("Using cached HPSSA 46 zip");
    zip = fs.readFileSync(ZIP_CACHE);
  } else {
    console.log("Downloading ONS HPSSA dataset 46 (median price paid by LSOA)...");
    const res = await fetch(DATA_URL, { headers: { "User-Agent": "Mozilla/5.0 (loclocloc scraper)" } });
    if (!res.ok) throw new Error(`Download returned HTTP ${res.status}`);
    zip = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(ZIP_CACHE, zip);
    console.log("Cached zip");
  }
  const { name, data } = extractZipEntry(zip, ".xls");
  fs.writeFileSync(XLS_CACHE, data);
  console.log(`Extracted "${name}" (${(data.length / 1e6).toFixed(1)} MB)`);
  return XLS_CACHE;
}

/**
 * Parse sheet 1a. Returns { periods, latest, rows } where rows maps LSOA11 code →
 * { latest: number|null, fallback: { value, period, lag }|null } for London LSOAs.
 */
function parseXls(path) {
  const wb = XLSX.readFile(path);
  const sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found (have: ${wb.SheetNames.join(", ")})`);
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  const hi = grid.findIndex((r) => r.includes(CODE_COL) && r.includes(LAD_COL));
  if (hi < 0) throw new Error(`Header row with "${CODE_COL}" not found`);
  const header = grid[hi];
  const iLad = header.indexOf(LAD_COL);
  const iCode = header.indexOf(CODE_COL);
  const iName = header.indexOf(NAME_COL);
  const periodCols = [];
  for (let i = iName + 1; i < header.length; i++) {
    if (typeof header[i] === "string" && /^Year ending /.test(header[i])) periodCols.push(i);
  }
  if (!periodCols.length) throw new Error("No 'Year ending …' period columns found");
  const iLatest = periodCols[periodCols.length - 1];
  const latestLabel = header[iLatest];

  const rows = new Map();
  for (let r = hi + 1; r < grid.length; r++) {
    const row = grid[r];
    const code = row[iCode];
    if (typeof code !== "string" || !/^E01/.test(code)) continue;
    if (!String(row[iLad]).startsWith("E09")) continue; // London boroughs only
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const latest = num(row[iLatest]);
    let fallback = null;
    if (latest == null) {
      for (let k = periodCols.length - 2; k >= Math.max(0, periodCols.length - 1 - MAX_FALLBACK_QUARTERS); k--) {
        const v = num(row[periodCols[k]]);
        if (v != null) {
          fallback = { value: v, period: header[periodCols[k]], lag: periodCols.length - 1 - k };
          break;
        }
      }
    }
    rows.set(code, { latest, fallback });
  }
  return { latestLabel, periods: periodCols.length, rows };
}

/** London rows of the ONS LSOA11→LSOA21 lookup: [{ LSOA11CD, LSOA21CD, CHGIND }]. */
async function fetchLookup() {
  if (fs.existsSync(LOOKUP_CACHE)) {
    console.log("Using cached LSOA11→LSOA21 lookup");
    return JSON.parse(fs.readFileSync(LOOKUP_CACHE, "utf-8"));
  }
  console.log("Fetching ONS LSOA11→LSOA21 lookup for London...");
  const out = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      where: "LAD22CD LIKE 'E09%'",
      outFields: "LSOA11CD,LSOA21CD,CHGIND",
      orderByFields: "ObjectId",
      returnGeometry: "false",
      resultOffset: String(offset),
      resultRecordCount: "1000",
      f: "json",
    });
    const res = await fetch(`${LOOKUP_URL}?${params}`);
    if (!res.ok) throw new Error(`Lookup returned HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`Lookup error: ${JSON.stringify(data.error)}`);
    const feats = data.features || [];
    out.push(...feats.map((f) => f.attributes));
    if (!data.exceededTransferLimit || !feats.length) break;
    offset += feats.length;
  }
  if (out.length < 4000) throw new Error(`Lookup only returned ${out.length} rows`);
  fs.writeFileSync(LOOKUP_CACHE, JSON.stringify(out));
  console.log(`Cached ${out.length} lookup rows`);
  return out;
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function main() {
  console.log("Building median house price choropleth...\n");

  const xlsPath = await fetchXls();
  const { latestLabel, periods, rows } = parseXls(xlsPath);
  const withLatest = [...rows.values()].filter((r) => r.latest != null).length;
  console.log(`Parsed ${rows.size} London LSOA (2011) rows across ${periods} periods; latest = "${latestLabel}"`);
  console.log(`  ${withLatest} have a value for the latest period, ${rows.size - withLatest} suppressed (":")`);

  const lookup = await fetchLookup();
  const parentsOf = new Map(); // LSOA21 → [LSOA11...]
  const chg = {};
  for (const { LSOA11CD, LSOA21CD, CHGIND } of lookup) {
    if (!parentsOf.has(LSOA21CD)) parentsOf.set(LSOA21CD, []);
    parentsOf.get(LSOA21CD).push(LSOA11CD);
    chg[CHGIND] = (chg[CHGIND] || 0) + 1;
  }
  console.log(`Lookup: ${lookup.length} rows, ${parentsOf.size} LSOA21 codes, change flags ${JSON.stringify(chg)}`);

  const lsoas = await getLSOABoundaries();
  const counts = { direct: 0, merged: 0, fallbackPeriod: 0, borough: 0, unmapped: 0 };
  const lagHist = {};
  const pending = [];

  for (const f of lsoas.features) {
    const code = f.properties.code;
    let parents = parentsOf.get(code);
    if (!parents) {
      counts.unmapped++;
      parents = [code];
    }
    const vals = [];
    let usedFallback = false;
    for (const p of parents) {
      const r = rows.get(p);
      if (!r) continue;
      if (r.latest != null) vals.push(r.latest);
      else if (r.fallback) {
        vals.push(r.fallback.value);
        usedFallback = true;
        lagHist[r.fallback.lag] = (lagHist[r.fallback.lag] || 0) + 1;
      }
    }
    if (vals.length) {
      f.properties.value = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
      if (usedFallback) counts.fallbackPeriod++;
      else if (parents.length > 1) counts.merged++;
      else counts.direct++;
    } else {
      f.properties.value = null;
      pending.push(f);
    }
  }

  // Borough median of resolved values for anything still empty
  const byBorough = {};
  for (const f of lsoas.features) {
    if (f.properties.value == null) continue;
    (byBorough[f.properties.borough] ||= []).push(f.properties.value);
  }
  const londonMedian = median(Object.values(byBorough).flat());
  for (const f of pending) {
    const b = byBorough[f.properties.borough];
    f.properties.value = Math.round(b?.length ? median(b) : londonMedian);
    counts.borough++;
  }

  console.log(`\nJoined ${lsoas.features.length} LSOAs (2021):`);
  console.log(`  ${counts.direct} direct (unchanged code, latest period)`);
  console.log(`  ${counts.merged} mean of several 2011 parents (merges)`);
  console.log(`  ${counts.fallbackPeriod} used an earlier period (quarters back → count: ${JSON.stringify(lagHist)})`);
  console.log(`  ${counts.borough} borough-median fallback (no value within ${MAX_FALLBACK_QUARTERS} quarters)`);
  console.log(`  ${counts.unmapped} codes absent from lookup (joined as-is)`);

  writeAreaLayer(OUTPUT_PATH, lsoas, {
    properties: ["value"],
    source: "ONS House Price Statistics for Small Areas, dataset 46 — median price paid by LSOA (HM Land Registry), mapped 2011→2021 LSOAs",
    vintage: latestLabel,
  });
  console.log(`Saved house price choropleth to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
