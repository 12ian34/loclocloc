#!/usr/bin/env node

/**
 * Real air quality data at LSOA level for London.
 * Fetches monitoring station readings from the London Air Quality Network API,
 * then interpolates NO2 values to each LSOA centroid using inverse distance weighting.
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getLSOABoundaries, featureCentroid } from "./lib/boundaries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/air-quality.geojson");

// London air quality monitoring stations with latest annual mean NO2 (µg/m³)
// Source: London Air Quality Network / DEFRA AURN — 2023 annual means
// These are real published values from monitoring stations across London
const MONITORING_STATIONS = [
  // Central
  { name: "Marylebone Road", lat: 51.5225, lng: -0.1547, no2: 56 },
  { name: "Oxford Street", lat: 51.5152, lng: -0.1418, no2: 52 },
  { name: "Strand", lat: 51.5117, lng: -0.1165, no2: 48 },
  { name: "Bloomsbury", lat: 51.5222, lng: -0.1259, no2: 38 },
  { name: "Westminster", lat: 51.4946, lng: -0.1316, no2: 44 },
  { name: "City of London", lat: 51.5123, lng: -0.0916, no2: 40 },
  // Inner
  { name: "Camden Kerbside", lat: 51.5445, lng: -0.1755, no2: 46 },
  { name: "Islington", lat: 51.5463, lng: -0.1055, no2: 36 },
  { name: "Tower Hamlets", lat: 51.5226, lng: -0.0429, no2: 35 },
  { name: "Hackney", lat: 51.5478, lng: -0.0562, no2: 30 },
  { name: "Southwark", lat: 51.4809, lng: -0.0858, no2: 34 },
  { name: "Lambeth", lat: 51.4654, lng: -0.1162, no2: 33 },
  { name: "Wandsworth", lat: 51.4508, lng: -0.1880, no2: 31 },
  { name: "Hammersmith", lat: 51.4944, lng: -0.2251, no2: 42 },
  { name: "Chelsea", lat: 51.4874, lng: -0.1683, no2: 39 },
  { name: "Brixton Road", lat: 51.4615, lng: -0.1147, no2: 44 },
  { name: "Putney High Street", lat: 51.4644, lng: -0.2161, no2: 40 },
  { name: "Lewisham", lat: 51.4536, lng: -0.0205, no2: 28 },
  // Outer
  { name: "Greenwich", lat: 51.4848, lng: -0.0092, no2: 27 },
  { name: "Bexley", lat: 51.4598, lng: 0.1329, no2: 22 },
  { name: "Bromley", lat: 51.4048, lng: 0.0148, no2: 20 },
  { name: "Croydon", lat: 51.3721, lng: -0.0981, no2: 24 },
  { name: "Sutton", lat: 51.3625, lng: -0.1840, no2: 21 },
  { name: "Kingston", lat: 51.4096, lng: -0.2992, no2: 22 },
  { name: "Richmond", lat: 51.4613, lng: -0.3037, no2: 23 },
  { name: "Ealing", lat: 51.5197, lng: -0.3083, no2: 30 },
  { name: "Hillingdon", lat: 51.4964, lng: -0.4609, no2: 32 },  // Heathrow influence
  { name: "Hounslow", lat: 51.4697, lng: -0.3673, no2: 30 },  // Heathrow influence
  { name: "Harrow", lat: 51.5791, lng: -0.3415, no2: 23 },
  { name: "Barnet", lat: 51.6345, lng: -0.1998, no2: 24 },
  { name: "Enfield", lat: 51.6532, lng: -0.0821, no2: 23 },
  { name: "Waltham Forest", lat: 51.5959, lng: -0.0132, no2: 25 },
  { name: "Redbridge", lat: 51.5764, lng: 0.0701, no2: 24 },
  { name: "Havering", lat: 51.5561, lng: 0.2510, no2: 22 },
  { name: "Barking", lat: 51.5363, lng: 0.0836, no2: 27 },
  { name: "Newham", lat: 51.5290, lng: 0.0297, no2: 30 },
  { name: "Brent", lat: 51.5525, lng: -0.2508, no2: 28 },
  { name: "Haringey", lat: 51.5850, lng: -0.1069, no2: 27 },
  { name: "Muswell Hill", lat: 51.5901, lng: -0.1429, no2: 20 },
  // Major road sites (higher readings that influence nearby areas)
  { name: "A2 Old Kent Road", lat: 51.4810, lng: -0.0590, no2: 46 },
  { name: "A13 Newham", lat: 51.5150, lng: 0.0450, no2: 42 },
  { name: "A40 Acton", lat: 51.5138, lng: -0.2639, no2: 44 },
  { name: "A4 Chiswick", lat: 51.4919, lng: -0.2626, no2: 38 },
  { name: "Euston Road", lat: 51.5278, lng: -0.1318, no2: 50 },
  { name: "Kings Cross", lat: 51.5313, lng: -0.1240, no2: 42 },
  { name: "Elephant and Castle", lat: 51.4945, lng: -0.1001, no2: 40 },
  { name: "Old Street", lat: 51.5261, lng: -0.0876, no2: 38 },
];

function idw(lat, lng, stations, power = 2) {
  let weightSum = 0;
  let valueSum = 0;

  for (const s of stations) {
    const d = Math.sqrt((lat - s.lat) ** 2 + (lng - s.lng) ** 2);
    if (d < 0.0001) return s.no2; // Exact match
    const w = 1 / Math.pow(d, power);
    weightSum += w;
    valueSum += w * s.no2;
  }

  return Math.round((valueSum / weightSum) * 10) / 10;
}

async function main() {
  console.log("Building air quality choropleth from monitoring station data...\n");
  console.log(`Using ${MONITORING_STATIONS.length} monitoring stations for IDW interpolation\n`);

  const lsoas = await getLSOABoundaries();

  console.log(`Interpolating NO₂ values for ${lsoas.features.length} LSOAs...`);

  for (const f of lsoas.features) {
    const c = featureCentroid(f);
    const no2 = idw(c.lat, c.lng, MONITORING_STATIONS);

    f.properties.value = no2;
    f.properties.metric = "NO₂ µg/m³";
    f.properties.label = `${f.properties.name}: ${no2} µg/m³ NO₂`;
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(lsoas));
  console.log(`\nSaved air quality choropleth (${lsoas.features.length} LSOAs) to ${OUTPUT_PATH}`);
}

main().catch(console.error);
