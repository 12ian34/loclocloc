#!/usr/bin/env node

/**
 * Scraper for schools in London with their latest Ofsted outcome.
 *
 * Sources (both Open Government Licence):
 *  1. DfE "Get Information about Schools" (GIAS) full daily extract
 *     https://get-information-schools.service.gov.uk/Downloads
 *     CSV: https://ea-edubase-api-prod.azurewebsites.net/edubase/downloads/public/edubasealldata<YYYYMMDD>.csv
 *     ~60 MB, latin1 encoded. Gives name / address / phase / type / coordinates (OSGB36 Easting, Northing).
 *     NOTE: the extract no longer carries "OfstedRating (name)" / "OfstedLastInsp" (dropped after the
 *     Sept 2024 end of single-word grades), so ratings are joined from source 2 by URN.
 *  2. Ofsted "Management information - state-funded schools - latest inspections as at <date>" CSV
 *     https://www.gov.uk/government/statistical-data-sets/monthly-management-information-ofsteds-school-inspections-outcomes
 *     Monthly. Covers state-funded schools only (independent schools are inspected by ISI / Ofsted
 *     under a different regime and are not in this file). Three tiers per school:
 *       - "latest full inspection"   -> new report cards (Nov 2025+; per-area grades, no overall grade)
 *       - "latest OEIF graded"       -> legacy 1-4 overall effectiveness (overall not judged after Sept 2024)
 *       - "latest ungraded"          -> "School remains Good" style outcomes
 *
 * Filters: Open; LA in the 33 London boroughs (GSSLACode E09*); phase in Nursery / Primary / Secondary /
 * All-through / 16 plus / Middle deemed *; phase "Not applicable" only for mainstream independent schools
 * (special schools, PRUs, alternative provision, universities, sixth-form centres are excluded).
 *
 * Raw downloads are cached in scrapers/.cache/ (gitignored). Output: public/data/schools.geojson
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { createInterface } from "readline";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writePointLayer } from "./lib/output.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/schools.geojson");
const CACHE_DIR = resolve(__dirname, "./.cache");

const GIAS_BASE = "https://ea-edubase-api-prod.azurewebsites.net/edubase/downloads/public/edubasealldata";
const OFSTED_MI_PAGE =
  "https://www.gov.uk/government/statistical-data-sets/monthly-management-information-ofsteds-school-inspections-outcomes";

const PHASES = new Set([
  "Nursery",
  "Primary",
  "Secondary",
  "All-through",
  "16 plus",
  "Middle deemed primary",
  "Middle deemed secondary",
]);
// Phase "Not applicable" is accepted only for these mainstream establishment types.
const NA_PHASE_MAINSTREAM_TYPES = new Set(["Other independent school", "City technology college"]);

// ---------------------------------------------------------------------------
// CSV helpers (streaming, quoted commas, doubled quotes; tolerates quoted newlines)
// ---------------------------------------------------------------------------

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function countQuotes(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === '"') n++;
  return n;
}

/** Streams a CSV file; calls onRow(rowObject) for each data row. */
async function streamCsv(path, encoding, onRow) {
  const rl = createInterface({ input: createReadStream(path, { encoding }), crlfDelay: Infinity });
  let header = null;
  let pending = "";
  for await (const raw of rl) {
    const line = pending ? `${pending}\n${raw}` : raw;
    if (countQuotes(line) % 2 === 1) { pending = line; continue; } // quoted field spans lines
    pending = "";
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    if (!header) {
      header = cells.map((h) => h.replace(/^\uFEFF/, "").trim());
      continue;
    }
    if (cells.length !== header.length) continue;
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i];
    onRow(row);
  }
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

async function downloadTo(url, path, { validate } = {}) {
  const res = await fetch(url, { headers: { "User-Agent": "loclocloc-scraper (github.com/12ian34/loclocloc)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const tmp = `${path}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  if (validate) {
    const ok = await validate(tmp);
    if (!ok) { const { unlinkSync } = await import("fs"); unlinkSync(tmp); throw new Error(`Validation failed for ${url}`); }
  }
  const { renameSync } = await import("fs");
  renameSync(tmp, path);
}

async function fileStartsWith(path, prefix) {
  const rl = createInterface({ input: createReadStream(path, { encoding: "latin1", end: 512 }) });
  for await (const line of rl) { rl.close(); return line.startsWith(prefix); }
  return false;
}

const ymd = (d) => d.toISOString().slice(0, 10);

/** Returns { path, date } for the newest GIAS extract available (today, else stepping back up to 10 days). */
async function fetchGias() {
  const cached = readdirSync(CACHE_DIR).filter((f) => /^_gias-edubasealldata\d{8}\.csv$/.test(f)).sort().pop();
  const today = new Date();
  if (cached) {
    const d = cached.match(/(\d{4})(\d{2})(\d{2})/);
    const date = `${d[1]}-${d[2]}-${d[3]}`;
    const ageDays = (today - new Date(date)) / 864e5;
    if (ageDays < 7) {
      console.log(`Using cached GIAS extract ${cached}`);
      return { path: resolve(CACHE_DIR, cached), date };
    }
  }
  for (let back = 0; back <= 10; back++) {
    const d = new Date(today.getTime() - back * 864e5);
    const stamp = ymd(d).replace(/-/g, "");
    const url = `${GIAS_BASE}${stamp}.csv`;
    const path = resolve(CACHE_DIR, `_gias-edubasealldata${stamp}.csv`);
    try {
      console.log(`Downloading GIAS extract ${url} ...`);
      // The endpoint answers HEAD with 500 and errors with a JSON body, so validate the body header row.
      await downloadTo(url, path, { validate: (p) => fileStartsWith(p, '"URN","LA (code)"') });
      return { path, date: ymd(d) };
    } catch (e) {
      console.log(`  not available (${e.message})`);
    }
  }
  throw new Error("No GIAS extract found for the last 10 days");
}

/** Finds the newest "latest inspections as at ..." CSV on the Ofsted MI page. Returns { path, asAt }. */
async function fetchOfstedMi() {
  const html = await (await fetch(OFSTED_MI_PAGE)).text();
  const re = /href="(https:\/\/assets\.publishing\.service\.gov\.uk\/media\/[^"]*latest_inspections[^"]*\.csv)"/gi;
  const links = [...html.matchAll(re)].map((m) => m[1]);
  if (!links.length) throw new Error("Could not find a 'latest inspections' CSV link on the Ofsted MI page");
  const url = links[0]; // page lists newest first
  const dateMatch = url.match(/as_at_(\d{1,2})_([A-Za-z]+)_(\d{4})/);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  let asAt = "unknown";
  if (dateMatch) {
    const mi = months.indexOf(dateMatch[2].slice(0, 3).toLowerCase());
    if (mi >= 0) asAt = `${dateMatch[3]}-${String(mi + 1).padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}`;
  }
  const path = resolve(CACHE_DIR, `_ofsted-mi-latest-inspections-${asAt.replace(/-/g, "")}.csv`);
  if (existsSync(path)) {
    console.log(`Using cached Ofsted MI ${path}`);
  } else {
    console.log(`Downloading Ofsted MI ${url} ...`);
    await downloadTo(url, path, { validate: (p) => fileStartsWith(p, "Web Link") });
  }
  return { path, asAt, url };
}

// ---------------------------------------------------------------------------
// OSGB36 National Grid -> WGS84 (Airy 1830 inverse Transverse Mercator, then Helmert). ~2-5 m accuracy.
// ---------------------------------------------------------------------------

function osgbToWgs84(E, N) {
  const a = 6377563.396, b = 6356256.909; // Airy 1830
  const F0 = 0.9996012717, lat0 = (49 * Math.PI) / 180, lon0 = (-2 * Math.PI) / 180, N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b), n2 = n * n, n3 = n2 * n;

  let lat = lat0, M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const Ma = (1 + n + 1.25 * n2 + 1.25 * n3) * (lat - lat0);
    const Mb = (3 * n + 3 * n2 + 2.625 * n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
    const Mc = (1.875 * n2 + 1.875 * n3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
    const Md = (35 / 24) * n3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (N - N0 - M >= 0.00001);

  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), tanLat = Math.tan(lat);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;
  const tan2 = tanLat * tanLat, tan4 = tan2 * tan2, tan6 = tan4 * tan2;
  const secLat = 1 / cosLat, nu3 = nu ** 3, nu5 = nu ** 5, nu7 = nu ** 7;
  const VII = tanLat / (2 * rho * nu);
  const VIII = (tanLat / (24 * rho * nu3)) * (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2);
  const IX = (tanLat / (720 * rho * nu5)) * (61 + 90 * tan2 + 45 * tan4);
  const X = secLat / nu;
  const XI = (secLat / (6 * nu3)) * (nu / rho + 2 * tan2);
  const XII = (secLat / (120 * nu5)) * (5 + 28 * tan2 + 24 * tan4);
  const XIIA = (secLat / (5040 * nu7)) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan6);
  const dE = E - E0, dE2 = dE * dE, dE3 = dE2 * dE, dE4 = dE2 * dE2, dE5 = dE3 * dE2, dE6 = dE4 * dE2, dE7 = dE5 * dE2;
  const phi = lat - VII * dE2 + VIII * dE4 - IX * dE6;
  const lam = lon0 + X * dE - XI * dE3 + XII * dE5 - XIIA * dE7;

  // Airy geodetic -> cartesian
  const sinP = Math.sin(phi), cosP = Math.cos(phi);
  const nuA = a / Math.sqrt(1 - e2 * sinP * sinP);
  const x = nuA * cosP * Math.cos(lam), y = nuA * cosP * Math.sin(lam), z = (1 - e2) * nuA * sinP;

  // Helmert OSGB36 -> WGS84 (OS parameters)
  const tx = 446.448, ty = -125.157, tz = 542.06, s = -20.4894e-6;
  const arc = Math.PI / 180 / 3600;
  const rx = 0.1502 * arc, ry = 0.247 * arc, rz = 0.8421 * arc;
  const x2 = tx + (1 + s) * x - rz * y + ry * z;
  const y2 = ty + rz * x + (1 + s) * y - rx * z;
  const z2 = tz - ry * x + rx * y + (1 + s) * z;

  // cartesian -> WGS84 geodetic
  const aW = 6378137, bW = 6356752.3142, e2W = 1 - (bW * bW) / (aW * aW);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let phiW = Math.atan2(z2, p * (1 - e2W)), prev;
  do {
    prev = phiW;
    const nuW = aW / Math.sqrt(1 - e2W * Math.sin(phiW) ** 2);
    phiW = Math.atan2(z2 + e2W * nuW * Math.sin(phiW), p);
  } while (Math.abs(phiW - prev) > 1e-12);
  return { lat: (phiW * 180) / Math.PI, lng: (Math.atan2(y2, x2) * 180) / Math.PI };
}

// ---------------------------------------------------------------------------
// Ofsted derivation
// ---------------------------------------------------------------------------

const nul = (v) => (v == null || v === "" || v === "NULL" ? "" : v.trim());
const ukDateToIso = (d) => {
  const m = nul(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};
const LEGACY_GRADE = { 1: "Outstanding", 2: "Good", 3: "Requires improvement", 4: "Inadequate" };
const CONCERN = { SM: "Special measures", SWK: "Serious weaknesses" };

const REPORT_CARD_AREAS = [
  ["Curriculum and teaching", "Curriculum & teaching"],
  ["Achievement", "Achievement"],
  ["Attendance and behaviour", "Attendance & behaviour"],
  ["Personal development and wellbeing", "Personal development"],
  ["Inclusion", "Inclusion"],
  ["Leadership and governance", "Leadership"],
  ["Early years (where applicable)", "Early years"],
  ["Post-16 provision (where applicable)", "Post-16"],
  ["Safeguarding standards", "Safeguarding"],
];
const OEIF_AREAS = [
  ["Latest OEIF quality of education", "Quality of education"],
  ["Latest OEIF behaviour and attitudes", "Behaviour"],
  ["Latest OEIF personal development", "Personal development"],
  ["Latest OEIF effectiveness of leadership and management", "Leadership"],
  ["Latest OEIF early years provision (where applicable)", "Early years"],
  ["Latest OEIF sixth form provision (where applicable)", "Sixth form"],
];

/**
 * Picks the most recent of the three inspection tiers and returns
 * { ofsted, ofstedType, ofstedDate, ofstedDetail, ofstedConcern, ofstedUrl }.
 */
function deriveOfsted(r) {
  const tiers = [];
  if (nul(r["Inspection number of latest full inspection"])) {
    tiers.push({ type: "report card", date: ukDateToIso(r["Inspection start date"]) });
  }
  if (nul(r["Inspection number of latest OEIF graded inspection"])) {
    tiers.push({ type: "graded", date: ukDateToIso(r["Inspection start date of latest OEIF graded inspection"]) });
  }
  if (nul(r["Latest ungraded inspection number"])) {
    tiers.push({ type: "ungraded", date: ukDateToIso(r["Date of latest ungraded inspection"]) });
  }
  const concernCode = nul(r["Most recent category of concern"]);
  const base = { ofstedConcern: CONCERN[concernCode] || "", ofstedUrl: nul(r["Web Link (opens in new window)"]) };
  if (!tiers.length) return { ofsted: "", ofstedType: "", ofstedDate: "", ofstedDetail: "", ...base };

  tiers.sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = tiers[0];
  const legacyGrade = LEGACY_GRADE[nul(r["Latest OEIF overall effectiveness"])] || "";

  if (latest.type === "report card") {
    const detail = REPORT_CARD_AREAS.map(([col, label]) => [label, nul(r[col])]).filter(([, v]) => v && !/^not applicable$/i.test(v));
    return {
      ofsted: "Report card",
      ofstedType: "report card",
      ofstedDate: latest.date,
      ofstedDetail: detail.map(([l, v]) => `${l}: ${v}`).join("; "),
      ...base,
    };
  }
  if (latest.type === "graded") {
    const detail = OEIF_AREAS.map(([col, label]) => [label, LEGACY_GRADE[nul(r[col])] || ""]).filter(([, v]) => v);
    return {
      ofsted: legacyGrade || "No overall grade",
      ofstedType: "graded",
      ofstedDate: latest.date,
      ofstedDetail: detail.map(([l, v]) => `${l}: ${v}`).join("; "),
      ...base,
    };
  }
  // ungraded: "School remains Good", "Standards maintained", "Improved significantly", ...
  const outcome = nul(r["Ungraded inspection overall outcome"]);
  const m = outcome.match(/remains (Outstanding|Good)/i);
  return {
    ofsted: m ? m[1] : legacyGrade || outcome,
    ofstedType: "ungraded",
    ofstedDate: latest.date,
    ofstedDetail: outcome,
    ...base,
  };
}

// ---------------------------------------------------------------------------

function tally(map, key) { map.set(key, (map.get(key) || 0) + 1); }
function printTally(title, map) {
  console.log(`\n${title}`);
  for (const [k, v] of [...map.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k || "(blank)"}`);
}

async function main() {
  console.log("Scraping London schools (GIAS + Ofsted MI)...\n");
  mkdirSync(CACHE_DIR, { recursive: true });

  const gias = await fetchGias();
  const ofstedMi = await fetchOfstedMi();

  // 1. Ofsted MI keyed by URN (state-funded schools only).
  const ofstedByUrn = new Map();
  await streamCsv(ofstedMi.path, "utf8", (r) => { if (r.URN) ofstedByUrn.set(r.URN, r); });
  console.log(`Ofsted MI: ${ofstedByUrn.size} schools (as at ${ofstedMi.asAt})`);

  // 2. GIAS rows -> features.
  const features = [];
  const stats = { london: 0, open: 0, phaseSkip: 0, noCoords: 0, ofstedJoined: 0 };
  const byPhase = new Map(), byOfsted = new Map(), bySector = new Map(), byType = new Map();

  await streamCsv(gias.path, "latin1", (r) => {
    if (!/^E09/.test(r["GSSLACode (name)"] || "")) return;
    stats.london++;
    if (r["EstablishmentStatus (name)"] !== "Open") return;
    stats.open++;

    const phase = r["PhaseOfEducation (name)"];
    const type = r["TypeOfEstablishment (name)"];
    if (!(PHASES.has(phase) || (phase === "Not applicable" && NA_PHASE_MAINSTREAM_TYPES.has(type)))) { stats.phaseSkip++; return; }

    const E = parseFloat(r.Easting), N = parseFloat(r.Northing);
    if (!Number.isFinite(E) || !Number.isFinite(N) || E <= 0 || N <= 0) { stats.noCoords++; return; }
    const { lat, lng } = osgbToWgs84(E, N);

    const sector = r["EstablishmentTypeGroup (name)"] === "Independent schools" ? "independent" : "state";
    const mi = ofstedByUrn.get(r.URN);
    if (mi) stats.ofstedJoined++;
    const ofsted = mi ? deriveOfsted(mi) : { ofsted: "", ofstedType: "", ofstedDate: "", ofstedDetail: "", ofstedConcern: "", ofstedUrl: "" };

    const lowAge = parseInt(r.StatutoryLowAge, 10), highAge = parseInt(r.StatutoryHighAge, 10);
    const religion = r["ReligiousCharacter (name)"] || "";

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        name: r.EstablishmentName.trim(),
        address: [r.Street, r.Locality, r.Address3, r.Town].map((s) => (s || "").trim()).filter(Boolean).join(", "),
        postcode: (r.Postcode || "").trim(),
        phase: phase === "Not applicable" ? "Independent (all ages)" : phase,
        type,
        sector,
        ...ofsted,
        urn: r.URN,
        website: (r.SchoolWebsite || "").trim(),
        religion: /^(does not apply|none)$/i.test(religion) ? "" : religion,
        ageLow: Number.isFinite(lowAge) ? lowAge : null,
        ageHigh: Number.isFinite(highAge) ? highAge : null,
        gender: r["Gender (name)"] || "",
        borough: r["LA (name)"] || "",
      },
    });
    tally(byPhase, phase);
    tally(bySector, sector);
    tally(byType, type);
    tally(byOfsted, ofsted.ofsted);
  });

  console.log(`\nGIAS London rows: ${stats.london}; open: ${stats.open}; skipped by phase/type: ${stats.phaseSkip}; no coordinates: ${stats.noCoords}`);
  console.log(`Ofsted joined by URN: ${stats.ofstedJoined} / ${features.length}`);
  printTally("By phase:", byPhase);
  printTally("By sector:", bySector);
  printTally("By Ofsted headline:", byOfsted);
  printTally("By establishment type:", byType);

  features.sort((a, b) => a.properties.name.localeCompare(b.properties.name));
  const meta = writePointLayer(OUTPUT_PATH, features, {
    source: "DfE Get Information about Schools (GIAS); Ofsted management information (state-funded schools)",
    vintage: gias.date,
    ofstedVintage: ofstedMi.asAt,
  });
  console.log(`\nSaved ${meta.count} schools to ${OUTPUT_PATH} (GIAS extract ${gias.date}, Ofsted MI as at ${ofstedMi.asAt})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
