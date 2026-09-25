#!/usr/bin/env node
/**
 * Collects the `meta` block from every bundled data file into public/data/manifest.json.
 * Runs before `vite build` (see package.json "prebuild") and can be run by hand after scraping.
 * The client reads the manifest for feature counts and "generated" dates without fetching each layer.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { resolve, dirname, extname, basename } from "path";
import { fileURLToPath } from "url";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../public/data");
const OUT = resolve(DATA_DIR, "manifest.json");

const layers = {};
for (const name of readdirSync(DATA_DIR).sort()) {
  if (name.startsWith("_") || name === "manifest.json") continue;
  const ext = extname(name);
  if (ext !== ".json" && ext !== ".geojson") continue;
  let doc;
  try {
    doc = JSON.parse(readFileSync(resolve(DATA_DIR, name), "utf-8"));
  } catch {
    console.warn(`skip ${name}: not JSON`);
    continue;
  }
  if (name === "lsoa-boundaries.geojson") {
    layers["lsoa-boundaries"] = {
      id: "lsoa-boundaries",
      kind: "boundaries",
      count: doc.features?.length ?? 0,
      generated: statSync(resolve(DATA_DIR, name)).mtime.toISOString().slice(0, 10),
      vintage: "ONS LSOA December 2021 (BSC generalised)",
      file: `/data/${name}`,
    };
    continue;
  }
  if (!doc.meta) {
    console.warn(`skip ${name}: no meta block (regenerate with scrapers/lib/output.js writers)`);
    continue;
  }
  const id = doc.meta.id || basename(name, ext);
  layers[id] = { ...doc.meta, id, kind: ext === ".geojson" ? "points" : "area", file: `/data/${name}` };
}

writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), layers }, null, 2) + "\n");
console.log(`manifest: ${Object.keys(layers).length} layers -> ${OUT}`);
