#!/usr/bin/env node

/**
 * River & sea flood risk at LSOA level for London.
 * Source: Environment Agency "Flood Map for Planning - Flood Zones" (OGL v3),
 * served as WFS from the Defra Data Services Platform. Flood Zone 3 = land with a
 * 1 in 100 (1%) or greater annual chance of flooding from rivers, or 1 in 200 (0.5%)
 * or greater from the sea, IGNORING flood defences (the planning-policy definition).
 *
 * value = percentage (0-100, 1 dp) of each LSOA's land area that lies inside Flood Zone 3.
 * Estimated by sampling a regular grid of points inside every LSOA polygon and counting the
 * share that fall inside any FZ3 polygon. Flood polygons are indexed with bbox buckets, and
 * point-in-polygon uses per-polygon latitude bands so the very large Thames polygons stay cheap.
 *
 * Raw WFS pages for the London bbox are cached under scrapers/.cache/ (gitignored).
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import { writeAreaLayer } from "./lib/output.js";
import { getLSOABoundaries } from "./lib/boundaries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/flood-risk.json");
const CACHE_DIR = resolve(__dirname, "./.cache");
const CACHE_PATH = resolve(CACHE_DIR, "_flood-zones-london.geojson");

const WFS_URL = "https://environment.data.gov.uk/spatialdata/flood-map-for-planning-flood-zones/wfs";
const TYPE_NAME = "dataset-04532375-a198-476e-985e-0579a0a11b47:Flood_Zones_2_3_Rivers_and_Sea";
/** lng/lat order — this WFS treats EPSG:4326 bbox as x,y */
const LONDON_BBOX = [-0.52, 51.28, 0.34, 51.7];
const PAGE_SIZE = 1000;

/** Spatial index cell size in degrees (~550 m x ~550 m at London's latitude) */
const CELL_LAT = 0.005;
const CELL_LNG = 0.008;
/** Latitude band height for per-polygon edge buckets (~110 m) */
const BAND = 0.001;
/** Target number of sample points per LSOA (after clipping to the polygon) */
const TARGET_SAMPLES = 300;
const MIN_SAMPLES = 120;

async function fetchWithRetry(url, tries = 5) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.features)) throw new Error("Response has no features array");
      return data;
    } catch (err) {
      lastErr = err;
      const wait = 2000 * attempt;
      console.log(`    attempt ${attempt} failed (${err.message}); retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function fetchFloodZones() {
  if (existsSync(CACHE_PATH)) {
    console.log("Using cached Flood Zones WFS download");
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  }

  console.log("Downloading EA Flood Zones (2 + 3) for the London bbox via WFS...");
  const features = [];
  const seen = new Set();
  let startIndex = 0;
  let total = null;

  while (true) {
    const params = new URLSearchParams({
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeNames: TYPE_NAME,
      outputFormat: "application/json",
      srsName: "EPSG:4326",
      bbox: `${LONDON_BBOX.join(",")},EPSG:4326`,
      count: String(PAGE_SIZE),
      startIndex: String(startIndex),
    });
    const data = await fetchWithRetry(`${WFS_URL}?${params}`);
    if (total == null) {
      total = data.numberMatched ?? data.totalFeatures ?? null;
      console.log(`  ${total ?? "?"} polygons intersect the bbox`);
    }
    for (const f of data.features) {
      const id = f.id ?? `${startIndex}:${features.length}`;
      if (seen.has(id)) continue;
      seen.add(id);
      features.push({ type: "Feature", id, geometry: f.geometry, properties: f.properties });
    }
    console.log(`  Fetched ${features.length}${total ? ` / ${total}` : ""}`);
    if (data.features.length < PAGE_SIZE) break;
    startIndex += PAGE_SIZE;
    if (total != null && startIndex >= total) break;
  }

  if (total != null && features.length < total * 0.98) {
    throw new Error(`Only received ${features.length} of ${total} flood polygons; refusing to write partial data`);
  }

  const fc = { type: "FeatureCollection", features };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(fc));
  console.log(`Cached ${features.length} flood polygons to ${CACHE_PATH}`);
  return fc;
}

/* ---------- Geometry helpers ---------- */

function bboxOfRings(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Prepares a polygon (outer ring + holes) for fast ray-casting: every edge is bucketed by the
 * latitude bands it spans, so a point test only visits edges at that latitude.
 */
function prepPolygon(rings) {
  const bbox = bboxOfRings(rings);
  const minY = bbox[1];
  const bands = [];
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      if (a[1] === b[1]) continue; // horizontal edges never cross a horizontal ray
      const lo = Math.floor((Math.min(a[1], b[1]) - minY) / BAND);
      const hi = Math.floor((Math.max(a[1], b[1]) - minY) / BAND);
      for (let k = lo; k <= hi; k++) {
        (bands[k] ||= []).push(a[0], a[1], b[0], b[1]);
      }
    }
  }
  return { bbox, minY, bands };
}

function insidePrepped(poly, x, y) {
  const [minX, minY, maxX, maxY] = poly.bbox;
  if (x < minX || x > maxX || y < minY || y > maxY) return false;
  const band = poly.bands[Math.floor((y - poly.minY) / BAND)];
  if (!band) return false;
  let inside = false;
  for (let i = 0; i < band.length; i += 4) {
    const ax = band[i], ay = band[i + 1], bx = band[i + 2], by = band[i + 3];
    if ((ay > y) !== (by > y)) {
      const xi = ax + ((y - ay) * (bx - ax)) / (by - ay);
      if (x < xi) inside = !inside;
    }
  }
  return inside;
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

/** Bbox-bucketed index of prepared flood polygons. */
function buildIndex(polys) {
  const cells = new Map();
  const key = (cx, cy) => cx * 100000 + cy;
  for (const poly of polys) {
    const [minX, minY, maxX, maxY] = poly.bbox;
    const cx0 = Math.floor(minX / CELL_LNG), cx1 = Math.floor(maxX / CELL_LNG);
    const cy0 = Math.floor(minY / CELL_LAT), cy1 = Math.floor(maxY / CELL_LAT);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = key(cx, cy);
        let arr = cells.get(k);
        if (!arr) cells.set(k, (arr = []));
        arr.push(poly);
      }
    }
  }
  return (x, y) => cells.get(key(Math.floor(x / CELL_LNG), Math.floor(y / CELL_LAT))) || [];
}

/** Regular grid of points inside an LSOA, refined until enough land inside the polygon. */
function samplePoints(feature) {
  const rings = polygonsOf(feature.geometry).flat();
  const [minX, minY, maxX, maxY] = bboxOfRings(rings);
  const w = maxX - minX, h = maxY - minY;
  if (!(w > 0) || !(h > 0)) return [];
  // Cells should be square-ish on the ground: 1 deg lng ~ 0.62 deg lat at 51.5N
  const cosLat = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
  let n = Math.ceil(Math.sqrt(TARGET_SAMPLES * 2)); // bbox cells along the longer side, before clipping
  for (let round = 0; round < 4; round++) {
    const step = Math.max(w * cosLat, h) / n;
    const stepX = step / cosLat, stepY = step;
    const pts = [];
    for (let y = minY + stepY / 2; y < maxY; y += stepY) {
      for (let x = minX + stepX / 2; x < maxX; x += stepX) {
        if (booleanPointInPolygon(point([x, y]), feature)) pts.push([x, y]);
      }
    }
    if (pts.length >= MIN_SAMPLES) return pts;
    n *= 2;
  }
  // Fallback for degenerate shapes: whatever we found at the finest grid
  const step = Math.max(w * cosLat, h) / n;
  const pts = [];
  for (let y = minY + step / 2; y < maxY; y += step) {
    for (let x = minX + step / cosLat / 2; x < maxX; x += step / cosLat) {
      if (booleanPointInPolygon(point([x, y]), feature)) pts.push([x, y]);
    }
  }
  return pts;
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

async function main() {
  const t0 = Date.now();
  console.log("Building flood risk (Flood Zone 3 coverage) choropleth...\n");

  const zones = await fetchFloodZones();
  const fz3 = zones.features.filter((f) => f.properties?.flood_zone === "FZ3");
  console.log(`\n${fz3.length} Flood Zone 3 polygons (of ${zones.features.length} zone 2+3 polygons)`);

  const prepped = [];
  let vertices = 0;
  for (const f of fz3) {
    for (const rings of polygonsOf(f.geometry)) {
      vertices += rings.reduce((s, r) => s + r.length, 0);
      prepped.push(prepPolygon(rings));
    }
  }
  console.log(`Indexed ${prepped.length} polygon parts, ${vertices} vertices`);
  const candidatesAt = buildIndex(prepped);

  const lsoas = await getLSOABoundaries();
  console.log(`Sampling ${lsoas.features.length} LSOAs...`);

  let totalSamples = 0;
  const values = [];
  for (let i = 0; i < lsoas.features.length; i++) {
    const f = lsoas.features[i];
    const pts = samplePoints(f);
    totalSamples += pts.length;
    let hits = 0;
    for (const [x, y] of pts) {
      const cands = candidatesAt(x, y);
      for (const poly of cands) {
        if (insidePrepped(poly, x, y)) {
          hits++;
          break;
        }
      }
    }
    const pct = pts.length ? Math.round((hits / pts.length) * 1000) / 10 : 0;
    f.properties.value = pct;
    f.properties.metric = "% of area in Flood Zone 3";
    values.push(pct);
    if ((i + 1) % 500 === 0) console.log(`  ${i + 1} / ${lsoas.features.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }

  console.log(`\nSampled ${totalSamples} points (avg ${(totalSamples / lsoas.features.length).toFixed(0)} per LSOA)`);
  const sorted = [...values].sort((a, b) => a - b);
  const gt = (t) => values.filter((v) => v > t).length;
  console.log(`LSOAs > 0%: ${gt(0)}   > 10%: ${gt(10)}   > 50%: ${gt(50)}   = 100%: ${values.filter((v) => v === 100).length}`);
  console.log(
    "Quantiles:",
    [0, 0.5, 0.75, 0.9, 0.95, 0.99, 1].map((q) => `p${Math.round(q * 100)}=${quantile(sorted, q).toFixed(1)}`).join("  ")
  );
  console.log(`Mean: ${(values.reduce((s, v) => s + v, 0) / values.length).toFixed(2)}%`);

  writeAreaLayer(OUTPUT_PATH, lsoas, {
    properties: ["value"],
    source: "Environment Agency Flood Map for Planning - Flood Zones (Flood Zone 3, undefended 1-in-100 river / 1-in-200 sea); % of LSOA area, grid-sampled",
    vintage: "EA dataset published 2025-03-25, data updated 2026-05-20",
  });
  console.log(`Saved flood risk choropleth to ${OUTPUT_PATH} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
