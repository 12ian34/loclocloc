/**
 * Fetches London LSOA boundaries from the ONS Open Geography Portal.
 * Step 1: Get London LSOA codes via the LSOA-to-LAD lookup table (LAD codes E09*)
 * Step 2: Fetch BSC boundaries for those LSOA codes (paginated)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(__dirname, "../../public/data/_lsoa-boundaries.geojson");

// LSOA-to-LAD lookup services
const LOOKUP_SERVICES = [
  { url: "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LSOA21_WD24_LAD24_EW_LU/FeatureServer/0/query", lsoa: "LSOA21CD", lad: "LAD24CD" },
  { url: "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LSOA21_WD23_LAD23_EW_LU/FeatureServer/0/query", lsoa: "LSOA21CD", lad: "LAD23CD" },
  { url: "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/LSOA21_WD22_LAD22_EW_LU_v3/FeatureServer/0/query", lsoa: "LSOA21CD", lad: "LAD22CD" },
];

const BOUNDARY_URL = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Lower_layer_Super_Output_Areas_December_2021_Boundaries_EW_BSC_V4/FeatureServer/0/query";

export async function getLSOABoundaries() {
  if (existsSync(CACHE_PATH)) {
    console.log("Using cached LSOA boundaries");
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  }

  // Step 1: Get London LSOA codes from lookup table
  console.log("Fetching London LSOA codes from lookup table...");
  let londonLSOAs = null;

  // London borough LAD codes: E09000001 to E09000033
  const boroughCodes = [];
  for (let i = 1; i <= 33; i++) boroughCodes.push(`E09${String(i).padStart(6, "0")}`);

  for (const lk of LOOKUP_SERVICES) {
    try {
      const codeSet = new Set();
      // Query each borough separately to stay under the 1000 record limit
      for (const ladCode of boroughCodes) {
        const params = new URLSearchParams({
          where: `${lk.lad} = '${ladCode}'`,
          outFields: lk.lsoa,
          f: "json",
          resultRecordCount: "1000",
          returnGeometry: "false",
        });
        const res = await fetch(`${lk.url}?${params}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (!data.features?.length) continue;
        for (const f of data.features) {
          codeSet.add(f.attributes[lk.lsoa]);
        }
      }
      console.log(`  ${codeSet.size} unique LSOA codes`);
      if (codeSet.size > 1000) {
        londonLSOAs = codeSet;
        console.log(`Got ${londonLSOAs.size} London LSOA codes`);
        break;
      }
    } catch (err) {
      console.log(`  Lookup error: ${err.message}`);
    }
  }

  if (!londonLSOAs) {
    throw new Error("Could not fetch London LSOA codes from lookup tables");
  }

  // Step 2: Fetch boundaries in batches using POST to avoid URL length limits
  console.log("\nFetching LSOA boundaries...");
  const allCodes = [...londonLSOAs];
  const allFeatures = [];
  const batchSize = 100;

  for (let i = 0; i < allCodes.length; i += batchSize) {
    const batch = allCodes.slice(i, i + batchSize);
    const whereClause = `LSOA21CD IN (${batch.map((c) => `'${c}'`).join(",")})`;

    const body = new URLSearchParams({
      where: whereClause,
      outFields: "LSOA21CD,LSOA21NM",
      f: "geojson",
      outSR: "4326",
    });

    try {
      const res = await fetch(BOUNDARY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) {
        console.log(`  Batch ${i}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (data.features) {
        for (const f of data.features) {
          f.properties = {
            code: f.properties.LSOA21CD,
            name: f.properties.LSOA21NM,
          };
          const match = f.properties.name.match(/^(.+?)\s+\d/);
          f.properties.borough = match ? match[1] : "";
        }
        allFeatures.push(...data.features);
      }
    } catch (err) {
      console.log(`  Batch ${i}: ${err.message}`);
    }

    if ((i / batchSize) % 10 === 0) {
      console.log(`  Fetched ${allFeatures.length} / ${allCodes.length} LSOAs`);
    }
  }

  if (allFeatures.length < 1000) {
    throw new Error(`Only got ${allFeatures.length} LSOA boundaries, expected ~4800+`);
  }

  const geojson = { type: "FeatureCollection", features: allFeatures };
  writeFileSync(CACHE_PATH, JSON.stringify(geojson));
  console.log(`\nCached ${allFeatures.length} LSOA boundaries`);
  return geojson;
}

/**
 * Compute centroid of a GeoJSON feature by averaging all coordinates.
 */
export function featureCentroid(feature) {
  const coords = [];
  function extract(geom) {
    if (Array.isArray(geom[0]) && Array.isArray(geom[0][0])) {
      geom.forEach(extract);
    } else if (Array.isArray(geom[0])) {
      coords.push(...geom);
    }
  }
  const g = feature.geometry;
  if (g.type === "Polygon") extract(g.coordinates);
  else if (g.type === "MultiPolygon") g.coordinates.forEach(extract);

  const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return { lat, lng };
}

/**
 * Distance in degrees from central London (Charing Cross).
 */
export function distFromCenter(lat, lng) {
  return Math.sqrt((lat - 51.5074) ** 2 + (lng + 0.1278) ** 2);
}

/**
 * Simple seeded hash for reproducible pseudo-random variation per area.
 */
export function areaHash(code) {
  let h = 0;
  for (let i = 0; i < code.length; i++) {
    h = ((h << 5) - h + code.charCodeAt(i)) | 0;
  }
  return (Math.sin(h) * 10000) % 1;
}
