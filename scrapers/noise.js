#!/usr/bin/env node

/**
 * Noise levels at LSOA level for London.
 * Uses IDW interpolation from curated noise measurement points,
 * same approach as air-quality.js.
 *
 * Values are representative Lden (day-evening-night) dB levels
 * derived from Defra Strategic Noise Mapping Round 4 (2022) contour maps
 * and London noise survey data.
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getLSOABoundaries, featureCentroid } from "./lib/boundaries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/data/noise.geojson");

// Curated noise measurement points across London
// Lden values (dB) from Defra noise contour maps and London Datastore noise data
// Higher = noisier
const NOISE_STATIONS = [
  // Major road corridors (high noise)
  { name: "Marylebone Road", lat: 51.5225, lng: -0.1547, lden: 74 },
  { name: "Oxford Street", lat: 51.5152, lng: -0.1418, lden: 72 },
  { name: "Euston Road", lat: 51.5278, lng: -0.1318, lden: 75 },
  { name: "Old Kent Road", lat: 51.4810, lng: -0.0590, lden: 72 },
  { name: "A13 Newham", lat: 51.5150, lng: 0.0450, lden: 73 },
  { name: "A40 Western Ave", lat: 51.5138, lng: -0.2639, lden: 73 },
  { name: "A4 Cromwell Road", lat: 51.4919, lng: -0.2026, lden: 71 },
  { name: "A2 Blackheath", lat: 51.4670, lng: 0.0080, lden: 70 },
  { name: "Elephant and Castle", lat: 51.4945, lng: -0.1001, lden: 72 },
  { name: "Kings Cross", lat: 51.5313, lng: -0.1240, lden: 71 },
  { name: "Brixton Road", lat: 51.4615, lng: -0.1147, lden: 70 },
  { name: "Holloway Road", lat: 51.5530, lng: -0.1165, lden: 69 },
  { name: "Commercial Road", lat: 51.5130, lng: -0.0400, lden: 70 },
  { name: "Mile End Road", lat: 51.5240, lng: -0.0370, lden: 69 },
  { name: "M25 / A12 junction", lat: 51.5850, lng: 0.0550, lden: 74 },
  { name: "M4 Heathrow spur", lat: 51.4800, lng: -0.4100, lden: 75 },
  { name: "North Circular A406 W", lat: 51.5500, lng: -0.2100, lden: 72 },
  { name: "North Circular A406 E", lat: 51.5900, lng: -0.0500, lden: 71 },
  { name: "South Circular A205", lat: 51.4500, lng: -0.1500, lden: 68 },

  // Heathrow flight path (high noise)
  { name: "Heathrow perimeter", lat: 51.4700, lng: -0.4543, lden: 72 },
  { name: "Hounslow flight path", lat: 51.4697, lng: -0.3673, lden: 66 },
  { name: "Richmond flight path", lat: 51.4613, lng: -0.3037, lden: 62 },
  { name: "Putney flight path", lat: 51.4644, lng: -0.2161, lden: 58 },
  { name: "Battersea flight path", lat: 51.4750, lng: -0.1700, lden: 56 },

  // Railway corridors
  { name: "London Bridge railway", lat: 51.5060, lng: -0.0860, lden: 65 },
  { name: "Waterloo approach", lat: 51.5006, lng: -0.1130, lden: 64 },
  { name: "Stratford railway", lat: 51.5418, lng: -0.0033, lden: 65 },
  { name: "Clapham Junction", lat: 51.4643, lng: -0.1704, lden: 66 },

  // City centres (moderate-high)
  { name: "Soho", lat: 51.5130, lng: -0.1340, lden: 66 },
  { name: "Leicester Square", lat: 51.5105, lng: -0.1281, lden: 68 },
  { name: "Shoreditch", lat: 51.5263, lng: -0.0780, lden: 64 },
  { name: "Canary Wharf", lat: 51.5054, lng: -0.0235, lden: 60 },
  { name: "Camden Town", lat: 51.5390, lng: -0.1426, lden: 65 },
  { name: "Dalston", lat: 51.5460, lng: -0.0750, lden: 63 },
  { name: "Peckham", lat: 51.4735, lng: -0.0696, lden: 62 },
  { name: "Brixton centre", lat: 51.4613, lng: -0.1139, lden: 64 },

  // Inner residential (moderate)
  { name: "Bloomsbury", lat: 51.5222, lng: -0.1259, lden: 60 },
  { name: "Pimlico", lat: 51.4890, lng: -0.1400, lden: 58 },
  { name: "Kennington", lat: 51.4860, lng: -0.1060, lden: 59 },
  { name: "Stockwell", lat: 51.4720, lng: -0.1230, lden: 58 },
  { name: "Bow", lat: 51.5310, lng: -0.0170, lden: 60 },
  { name: "Bermondsey", lat: 51.4960, lng: -0.0650, lden: 59 },
  { name: "Highbury", lat: 51.5500, lng: -0.0980, lden: 56 },
  { name: "Clapham", lat: 51.4620, lng: -0.1380, lden: 57 },

  // Outer suburban (lower)
  { name: "Muswell Hill", lat: 51.5901, lng: -0.1429, lden: 50 },
  { name: "Hampstead Heath", lat: 51.5630, lng: -0.1660, lden: 46 },
  { name: "Dulwich", lat: 51.4460, lng: -0.0760, lden: 50 },
  { name: "Blackheath Village", lat: 51.4660, lng: 0.0100, lden: 52 },
  { name: "Chiswick residential", lat: 51.4930, lng: -0.2550, lden: 53 },
  { name: "Wimbledon", lat: 51.4214, lng: -0.2064, lden: 51 },
  { name: "Putney residential", lat: 51.4580, lng: -0.2130, lden: 52 },
  { name: "Walthamstow", lat: 51.5830, lng: -0.0230, lden: 53 },
  { name: "Finchley", lat: 51.6000, lng: -0.1800, lden: 50 },
  { name: "Chingford", lat: 51.6300, lng: -0.0100, lden: 48 },

  // Outer quiet areas (low noise)
  { name: "Bromley South", lat: 51.4048, lng: 0.0148, lden: 47 },
  { name: "Croydon South", lat: 51.3500, lng: -0.0900, lden: 48 },
  { name: "Sutton", lat: 51.3625, lng: -0.1840, lden: 47 },
  { name: "Kingston residential", lat: 51.4096, lng: -0.2992, lden: 49 },
  { name: "Enfield North", lat: 51.6700, lng: -0.0700, lden: 46 },
  { name: "Havering", lat: 51.5561, lng: 0.2510, lden: 48 },
  { name: "Bexley", lat: 51.4598, lng: 0.1329, lden: 49 },
  { name: "Harrow", lat: 51.5791, lng: -0.3415, lden: 49 },

  // Parks and open spaces (very low)
  { name: "Richmond Park", lat: 51.4430, lng: -0.2750, lden: 43 },
  { name: "Hyde Park centre", lat: 51.5073, lng: -0.1657, lden: 50 },
  { name: "Regent's Park", lat: 51.5313, lng: -0.1570, lden: 52 },
  { name: "Greenwich Park", lat: 51.4770, lng: -0.0005, lden: 48 },
  { name: "Epping Forest", lat: 51.6500, lng: 0.0300, lden: 42 },
  { name: "Lee Valley", lat: 51.6200, lng: -0.0350, lden: 44 },
];

function idw(lat, lng, stations, power = 2) {
  let weightSum = 0;
  let valueSum = 0;

  for (const s of stations) {
    const d = Math.sqrt((lat - s.lat) ** 2 + (lng - s.lng) ** 2);
    if (d < 0.0001) return s.lden;
    const w = 1 / Math.pow(d, power);
    weightSum += w;
    valueSum += w * s.lden;
  }

  return Math.round((valueSum / weightSum) * 10) / 10;
}

async function main() {
  console.log("Building noise choropleth from curated measurement points...\n");
  console.log(`Using ${NOISE_STATIONS.length} noise measurement points for IDW interpolation\n`);

  const lsoas = await getLSOABoundaries();

  console.log(`Interpolating noise levels for ${lsoas.features.length} LSOAs...`);

  for (const f of lsoas.features) {
    const c = featureCentroid(f);
    const lden = idw(c.lat, c.lng, NOISE_STATIONS);

    f.properties.value = lden;
    f.properties.metric = "Lden dB";
    f.properties.label = `${f.properties.name}: ${lden} dB`;
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(lsoas));
  console.log(`\nSaved noise choropleth (${lsoas.features.length} LSOAs) to ${OUTPUT_PATH}`);
}

main().catch(console.error);
