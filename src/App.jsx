import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Circle,
  Polygon,
  Popup,
  GeoJSON,
  Marker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

const LONDON_CENTER = [51.505, -0.09];
const LONDON_ZOOM = 11;

const POINT_LAYERS = [
  { id: "tube", name: "Tube & Rail", file: "/data/tube-rail.geojson", color: "#003688", emoji: "🚇" },
  { id: "waitrose", name: "Waitrose", file: "/data/waitrose.geojson", color: "#4a7c59", emoji: "🛒" },
  { id: "coffee", name: "Coffee Shops", file: "/data/coffee.geojson", color: "#6f4e37", emoji: "☕" },
  { id: "pubs", name: "Pubs", file: "/data/pubs.geojson", color: "#c9a227", emoji: "🍺" },
  { id: "parks", name: "Parks", file: "/data/parks.geojson", color: "#2d8c3c", emoji: "🌳" },
  { id: "yoga", name: "Yoga Studios", file: "/data/yoga.geojson", color: "#c06cba", emoji: "🧘" },
  { id: "gyms", name: "Gyms", file: "/data/gyms.geojson", color: "#e05555", emoji: "💪" },
  { id: "cinemas", name: "Cinemas", file: "/data/cinemas.geojson", color: "#8b5cf6", emoji: "🎬" },
  { id: "bike-parking", name: "Bike Parking", file: "/data/bike-parking.geojson", color: "#0ea5e9", emoji: "🚲" },
  { id: "betting", name: "Betting Shops", file: "/data/betting.geojson", color: "#ef4444", emoji: "🎰" },
];

const CHOROPLETH_LAYERS = [
  {
    id: "crime-current",
    name: "Crime (Current)",
    file: "/data/crime.geojson",
    property: "value",
    emoji: "🚨",
    unit: "monthly crimes",
    colorStops: ["#fff5f0", "#fdcab5", "#fc8d6a", "#e7442e", "#a50f15", "#67000d"],
    format: (v) => `${v}`,
    inverse: true,
  },
  {
    id: "air",
    name: "Air Quality (NO₂)",
    file: "/data/air-quality.geojson",
    property: "value",
    emoji: "🌫️",
    unit: "µg/m³",
    colorStops: ["#f0f9e8", "#bae4bc", "#7bccc4", "#f4a460", "#d95f0e", "#8b4513"],
    format: (v) => `${v}`,
    inverse: true,
  },
  {
    id: "imd",
    name: "Deprivation (Overall)",
    file: "/data/imd.geojson",
    property: "imd",
    emoji: "📊",
    unit: "IMD score",
    colorStops: ["#f7fcf5", "#c7e9c0", "#74c476", "#fd8d3c", "#e6550d", "#a63603"],
    format: (v) => `${v}`,
    inverse: true,
  },
  {
    id: "imd-income",
    name: "Income Deprivation",
    file: "/data/imd.geojson",
    property: "income",
    emoji: "💰",
    unit: "rate",
    colorStops: ["#f7fbff", "#c6dbef", "#6baed6", "#3182bd", "#08519c", "#08306b"],
    format: (v) => `${(v * 100).toFixed(0)}%`,
    inverse: true,
  },
  {
    id: "imd-employment",
    name: "Employment Deprivation",
    file: "/data/imd.geojson",
    property: "employment",
    emoji: "💼",
    unit: "rate",
    colorStops: ["#fff5eb", "#fdd0a2", "#fdae6b", "#f16913", "#d94801", "#8c2d04"],
    format: (v) => `${(v * 100).toFixed(0)}%`,
    inverse: true,
  },
  {
    id: "imd-education",
    name: "Education Deprivation",
    file: "/data/imd.geojson",
    property: "education",
    emoji: "🎓",
    unit: "score",
    colorStops: ["#f7fcfd", "#ccece6", "#66c2a4", "#41ae76", "#238b45", "#005824"],
    format: (v) => `${v.toFixed(1)}`,
    inverse: true,
  },
  {
    id: "imd-health",
    name: "Health Deprivation",
    file: "/data/imd.geojson",
    property: "health",
    emoji: "🏥",
    unit: "score",
    colorStops: ["#f7fcfd", "#d0d1e6", "#a6bddb", "#74a9cf", "#2b8cbe", "#045a8d"],
    format: (v) => `${v.toFixed(1)}`,
    inverse: true,
  },
  {
    id: "imd-crime",
    name: "Crime (IMD 2019)",
    file: "/data/imd.geojson",
    property: "crime",
    emoji: "🔒",
    unit: "score",
    colorStops: ["#fff5f0", "#fdcab5", "#fc8d6a", "#e7442e", "#a50f15", "#67000d"],
    format: (v) => `${v.toFixed(1)}`,
    inverse: true,
  },
  {
    id: "imd-barriers",
    name: "Housing Barriers",
    file: "/data/imd.geojson",
    property: "barriers",
    emoji: "🏠",
    unit: "score",
    colorStops: ["#f2f0f7", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f", "#3f007d"],
    format: (v) => `${v.toFixed(1)}`,
    inverse: true,
  },
  {
    id: "imd-living",
    name: "Living Environment",
    file: "/data/imd.geojson",
    property: "living",
    emoji: "🌍",
    unit: "score",
    colorStops: ["#ffffcc", "#d9f0a3", "#addd8e", "#78c679", "#31a354", "#006837"],
    format: (v) => `${v.toFixed(1)}`,
    inverse: true,
  },
];

// Transit isochrone config
const TRANSIT_RINGS = [
  { mins: 15, opacity: 0.20 },
  { mins: 30, opacity: 0.12 },
  { mins: 45, opacity: 0.06 },
];

// Distinct colours per postcode for transit overlays
const TRANSIT_COLORS = [
  "#3b82f6", "#e040fb", "#00bcd4", "#ff9800", "#8bc34a", "#f44336",
];

// Walking rings: minutes -> meters (avg walking speed ~80m/min)
const WALK_RINGS = [
  { mins: 5, meters: 400, color: "#ff3366", opacity: 0.18 },
  { mins: 10, meters: 800, color: "#ff3366", opacity: 0.12 },
  { mins: 15, meters: 1200, color: "#ff3366", opacity: 0.08 },
  { mins: 20, meters: 1600, color: "#ff3366", opacity: 0.05 },
];

// Score dimensions used for the postcode scorecard
const SCORE_AREA_DIMS = [
  { id: "crime-current", label: "Low Crime", property: "value", choroplethFile: "/data/crime.geojson", tip: "Monthly street-level crimes from data.police.uk. Scored by inverse percentile across all London LSOAs — fewer crimes = higher score." },
  { id: "air", label: "Clean Air", property: "value", choroplethFile: "/data/air-quality.geojson", tip: "NO\u2082 concentration (\u00b5g/m\u00b3) interpolated from London Air Quality Network monitoring stations. Lower pollution = higher score." },
  { id: "imd", label: "Low Deprivation", property: "imd", choroplethFile: "/data/imd.geojson", tip: "Overall Index of Multiple Deprivation (IMD 2019) from ONS. Combines income, employment, education, health, crime, housing & environment. Lower deprivation = higher score." },
  { id: "imd-income", label: "Income", property: "income", choroplethFile: "/data/imd.geojson", tip: "IMD Income Deprivation rate — proportion of the population experiencing deprivation relating to low income. Lower rate = higher score." },
  { id: "imd-education", label: "Education", property: "education", choroplethFile: "/data/imd.geojson", tip: "IMD Education, Skills & Training score. Measures lack of attainment and skills in the local population. Lower deprivation = higher score." },
  { id: "imd-health", label: "Health", property: "health", choroplethFile: "/data/imd.geojson", tip: "IMD Health Deprivation & Disability score. Measures risk of premature death and impairment of quality of life through poor health. Lower = higher score." },
  { id: "imd-barriers", label: "Housing Access", property: "barriers", choroplethFile: "/data/imd.geojson", tip: "IMD Barriers to Housing & Services score. Measures physical and financial accessibility of housing and local services. Lower barriers = higher score." },
  { id: "imd-living", label: "Living Env.", property: "living", choroplethFile: "/data/imd.geojson", tip: "IMD Living Environment score. Measures quality of the indoor and outdoor local environment (housing condition, air quality, road traffic accidents). Lower = higher score." },
];

// cap = density-weight sum needed for a perfect 100. Higher = harder to max out.
const SCORE_PROX_DIMS = [
  { id: "tube", label: "Tube/Rail", pointLayer: "tube", cap: 8, tip: "Density-weighted score for nearby Tube/Rail stations. Rewards multiple stations within walking distance. More stations closer = higher score." },
  { id: "waitrose", label: "Waitrose", pointLayer: "waitrose", cap: 3, tip: "Density-weighted score for nearby Waitrose stores. Rewards having options, not just one far away." },
  { id: "coffee", label: "Coffee", pointLayer: "coffee", cap: 12, tip: "Density-weighted score for nearby coffee shops. Rewards areas with a good selection within walking distance." },
  { id: "pubs", label: "Pubs", pointLayer: "pubs", cap: 15, tip: "Density-weighted score for nearby pubs. Rewards areas with good pub density." },
  { id: "parks", label: "Parks", pointLayer: "parks", cap: 5, tip: "Density-weighted score for nearby parks and gardens. Multiple green spaces nearby = higher score." },
  { id: "yoga", label: "Yoga", pointLayer: "yoga", cap: 4, tip: "Density-weighted score for nearby yoga studios. Rewards areas with good studio density." },
  { id: "gyms", label: "Gym", pointLayer: "gyms", cap: 6, tip: "Density-weighted score for nearby gyms/fitness centres. Rewards having several options to choose from." },
  { id: "cinemas", label: "Cinemas", pointLayer: "cinemas", cap: 3, tip: "Density-weighted score for nearby cinemas. Rewards having options within reach." },
  { id: "bike-parking", label: "Bike Parking", pointLayer: "bike-parking", cap: 30, tip: "Density-weighted score for nearby bicycle parking. Very abundant in London; needs high density to score well." },
  { id: "betting", label: "No Betting", pointLayer: "betting", inverse: true, cap: 4, tip: "Inverse density score — more betting shops nearby = lower score. Areas with none nearby score 100." },
];

/* ── Utility functions ─────────────────────────────────────── */

function interpolateColor(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const idx = t * (stops.length - 1);
  const low = Math.floor(idx);
  const high = Math.ceil(idx);
  if (low === high) return stops[low];
  const f = idx - low;
  const c1 = stops[low], c2 = stops[high];
  const r = Math.round(parseInt(c1.slice(1, 3), 16) * (1 - f) + parseInt(c2.slice(1, 3), 16) * f);
  const g = Math.round(parseInt(c1.slice(3, 5), 16) * (1 - f) + parseInt(c2.slice(3, 5), 16) * f);
  const b = Math.round(parseInt(c1.slice(5, 7), 16) * (1 - f) + parseInt(c2.slice(5, 7), 16) * f);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function computeScale(features, property = "value") {
  const values = features.map((f) => f.properties[property]).filter((v) => v > 0).sort((a, b) => a - b);
  const p5 = values[Math.floor(values.length * 0.05)];
  const p95 = values[Math.floor(values.length * 0.95)];
  return { min: p5, max: p95 };
}

function computeCentroids(features, property = "value") {
  return features.map((f) => {
    const coords = [];
    function extract(geom) {
      if (Array.isArray(geom[0]) && Array.isArray(geom[0][0])) {
        geom.forEach(extract);
      } else if (Array.isArray(geom[0])) {
        coords.push(...geom);
      }
    }
    const g = f.geometry;
    if (g.type === "Polygon") extract(g.coordinates);
    else if (g.type === "MultiPolygon") g.coordinates.forEach(extract);
    const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    return { lat, lng, value: f.properties[property], name: f.properties.name };
  });
}

// Haversine distance in meters
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Ray-casting point-in-polygon
function pointInPolygon(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = [ring[i][1], ring[i][0]]; // GeoJSON is [lng, lat]
    const [xj, yj] = [ring[j][1], ring[j][0]];
    if (yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Find the LSOA feature containing a point (fall back to nearest centroid)
function findLSOAForPoint(lat, lng, features) {
  // Try exact polygon containment first
  for (const f of features) {
    const g = f.geometry;
    if (g.type === "Polygon") {
      if (pointInPolygon(lat, lng, g.coordinates[0])) return f;
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates) {
        if (pointInPolygon(lat, lng, poly[0])) return f;
      }
    }
  }
  // Fallback: nearest centroid
  let bestDist = Infinity;
  let bestFeature = null;
  for (const f of features) {
    const c = featureCentroid(f);
    const d = (lat - c.lat) ** 2 + (lng - c.lng) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestFeature = f;
    }
  }
  return bestFeature;
}

function featureCentroid(f) {
  const coords = [];
  function extract(geom) {
    if (Array.isArray(geom[0]) && Array.isArray(geom[0][0])) geom.forEach(extract);
    else if (Array.isArray(geom[0])) coords.push(...geom);
  }
  const g = f.geometry;
  if (g.type === "Polygon") extract(g.coordinates);
  else if (g.type === "MultiPolygon") g.coordinates.forEach(extract);
  return {
    lat: coords.reduce((s, c) => s + c[1], 0) / coords.length,
    lng: coords.reduce((s, c) => s + c[0], 0) / coords.length,
  };
}

// Distance to nearest point feature (returns meters)
function nearestPointDistance(lat, lng, features) {
  let best = Infinity;
  for (const f of features) {
    const [fLng, fLat] = f.geometry.coordinates;
    const d = haversine(lat, lng, fLat, fLng);
    if (d < best) best = d;
  }
  return best;
}

// Compute percentile rank (0-100) of a value in a sorted array
function percentileRank(value, sortedValues) {
  let low = 0, high = sortedValues.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sortedValues[mid] < value) low = mid + 1;
    else high = mid;
  }
  return (low / sortedValues.length) * 100;
}

// Density-weighted proximity score: sums distance-weighted contributions from all POIs within radius
function densityProximityScore(lat, lng, features, cap, maxDist = 2000) {
  let sum = 0;
  let nearest = Infinity;
  let count = 0;
  for (const f of features) {
    const [fLng, fLat] = f.geometry.coordinates;
    const d = haversine(lat, lng, fLat, fLng);
    if (d < nearest) nearest = d;
    if (d > maxDist) continue;
    sum += (maxDist - d) / maxDist;
    count++;
  }
  const score = Math.min(100, Math.round((sum / cap) * 100));
  return { score, nearest: Math.round(nearest), count };
}

// Precompute sorted arrays for each choropleth dimension
function buildPercentileLookups(choroplethData) {
  const lookups = {};
  const seen = {};
  for (const layer of CHOROPLETH_LAYERS) {
    if (seen[layer.id]) continue;
    seen[layer.id] = true;
    const data = choroplethData[layer.id];
    if (!data) continue;
    const vals = data.features
      .map((f) => f.properties[layer.property])
      .filter((v) => v != null)
      .sort((a, b) => a - b);
    lookups[layer.id] = vals;
  }
  return lookups;
}

// Compute full scorecard for a postcode location
function computePostcodeScores(lat, lng, choroplethData, layerData, percentileLookups, disabledDims) {
  const scores = { area: {}, proximity: {}, overall: 0 };
  let total = 0;
  let count = 0;

  // Area scores: find LSOA in each choropleth dataset, compute inverse percentile
  const lsoaCache = {};
  for (const dim of SCORE_AREA_DIMS) {
    const data = choroplethData[dim.id];
    if (!data) continue;
    const cacheKey = dim.choroplethFile;
    if (!lsoaCache[cacheKey]) {
      lsoaCache[cacheKey] = findLSOAForPoint(lat, lng, data.features);
    }
    const lsoa = lsoaCache[cacheKey];
    if (!lsoa) continue;
    const rawValue = lsoa.properties[dim.property];
    if (rawValue == null) continue;
    const sorted = percentileLookups[dim.id];
    if (!sorted) continue;
    // All area dimensions are "lower is better" (inverse)
    const pct = percentileRank(rawValue, sorted);
    const score = Math.round(100 - pct);
    const enabled = !disabledDims.has(dim.id);
    scores.area[dim.id] = { score, raw: rawValue, label: dim.label, enabled, tip: dim.tip };
    if (enabled) { total += score; count++; }
  }

  // Proximity scores (density-weighted)
  for (const dim of SCORE_PROX_DIMS) {
    const features = layerData[dim.pointLayer]?.features;
    if (!features || features.length === 0) continue;
    const { score: rawScore, nearest, count: nearby } = densityProximityScore(lat, lng, features, dim.cap);
    // Inverse: more nearby = worse (e.g. betting shops)
    const score = dim.inverse ? Math.max(0, 100 - rawScore) : rawScore;
    const enabled = !disabledDims.has(dim.id);
    scores.proximity[dim.id] = { score, dist: nearest, nearby, label: dim.label, enabled, tip: dim.tip };
    if (enabled) { total += score; count++; }
  }

  scores.overall = count > 0 ? Math.round(total / count) : 0;
  return scores;
}

/* ── Transit isochrone computation (TfL Journey Planner API) ── */

const TFL_API_KEY = import.meta.env.VITE_TFL_API_KEY || "";

async function queryTfLJourneyTime(fromLat, fromLng, toLat, toLng) {
  const base = "https://api.tfl.gov.uk/Journey/JourneyResults";
  const from = `${fromLat.toFixed(5)},${fromLng.toFixed(5)}`;
  const to = `${toLat.toFixed(5)},${toLng.toFixed(5)}`;
  const params = new URLSearchParams({
    mode: "tube,dlr,elizabeth-line,overground,national-rail,bus,tram,walking",
    app_key: TFL_API_KEY,
  });
  try {
    const res = await fetch(`${base}/${from}/to/${to}?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.journeys?.length) return null;
    // Return fastest journey duration
    return Math.min(...data.journeys.map((j) => j.duration));
  } catch {
    return null;
  }
}

async function computeTransitIsochrones(lat, lng) {
  const numAngles = 24;
  const sampleDistKm = [2, 5, 10, 16]; // km from origin
  const targetMinutes = TRANSIT_RINGS.map((r) => r.mins);
  const cosLat = Math.cos((lat * Math.PI) / 180);

  // Build sample grid: numAngles directions × sampleDistKm distances
  const samples = [];
  for (let i = 0; i < numAngles; i++) {
    const angle = (i / numAngles) * 2 * Math.PI;
    for (const dist of sampleDistKm) {
      const destLat = lat + (dist / 111) * Math.cos(angle);
      const destLng = lng + (dist / (111 * cosLat)) * Math.sin(angle);
      samples.push({ angleIdx: i, angle, dist, destLat, destLng, time: null });
    }
  }

  // Query TfL in batches of 10 (stay well within rate limits)
  const BATCH = 10;
  for (let b = 0; b < samples.length; b += BATCH) {
    const batch = samples.slice(b, b + BATCH);
    const results = await Promise.all(
      batch.map((s) => queryTfLJourneyTime(lat, lng, s.destLat, s.destLng))
    );
    batch.forEach((s, i) => { s.time = results[i]; });
  }

  // For each target time, interpolate the reach distance per angle
  const isochrones = {};
  for (const target of targetMinutes) {
    const points = [];
    for (let i = 0; i < numAngles; i++) {
      const angleSamples = samples
        .filter((s) => s.angleIdx === i && s.time != null)
        .sort((a, b) => a.dist - b.dist);

      let reachKm = target * 0.08; // fallback: walking

      if (angleSamples.length >= 2) {
        // Find bracketing pair
        let found = false;
        for (let j = 0; j < angleSamples.length - 1; j++) {
          const s1 = angleSamples[j], s2 = angleSamples[j + 1];
          if (s1.time <= target && s2.time > target) {
            const t = (target - s1.time) / (s2.time - s1.time);
            reachKm = s1.dist + t * (s2.dist - s1.dist);
            found = true;
            break;
          }
        }
        if (!found) {
          const last = angleSamples[angleSamples.length - 1];
          const first = angleSamples[0];
          if (last.time <= target) {
            // All samples reachable — extrapolate
            reachKm = Math.min(30, last.dist * 1.2);
          } else if (first.time > target) {
            // Even closest too far — interpolate down from first
            reachKm = Math.max(0.3, first.dist * (target / first.time));
          }
        }
      } else if (angleSamples.length === 1) {
        const s = angleSamples[0];
        reachKm = Math.max(0.3, Math.min(25, s.dist * (target / s.time)));
      }

      const angle = (i / numAngles) * 2 * Math.PI;
      points.push([
        lat + (reachKm / 111) * Math.cos(angle),
        lng + (reachKm / (111 * cosLat)) * Math.sin(angle),
      ]);
    }
    isochrones[target] = points;
  }

  return isochrones;
}

/* ── URL state helpers ─────────────────────────────────────── */

function encodeAppState({ postcodes, activeLayers, activeChoropleth, opacity, showRings, filters }) {
  const params = new URLSearchParams();
  if (postcodes.length) params.set("p", postcodes.map((p) => p.postcode.replace(/\s/g, "")).join(","));
  if (activeLayers.size) params.set("l", [...activeLayers].join(","));
  if (activeChoropleth) params.set("c", activeChoropleth);
  if (opacity !== 0.65) params.set("o", opacity.toFixed(2));
  if (showRings) params.set("r", "1");
  if (filters && Object.keys(filters).length) params.set("f", JSON.stringify(filters));
  return params.toString();
}

function decodeAppState(hash) {
  try {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    return {
      postcodes: params.get("p")?.split(",").filter(Boolean) || [],
      layers: params.get("l")?.split(",").filter(Boolean) || null,
      choropleth: params.get("c") || null,
      opacity: params.has("o") ? parseFloat(params.get("o")) : 0.65,
      showRings: params.get("r") === "1",
      filters: params.has("f") ? JSON.parse(params.get("f")) : {},
    };
  } catch {
    return { postcodes: [], layers: null, choropleth: null, opacity: 0.65, showRings: false, filters: {} };
  }
}

/* ── Map sub-components ────────────────────────────────────── */

function PointMarkers({ layers, activeLayers, layerData }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => map.off("zoomend", onZoom);
  }, [map]);

  const radius = Math.max(1, (zoom - 8) * 1.5);
  const weight = zoom < 13 ? 0 : 1;
  const opacity = zoom < 10 ? 0.5 : 0.8;

  return layers.map(
    (layer) =>
      activeLayers.has(layer.id) &&
      layerData[layer.id]?.features.map((feature, i) => (
        <CircleMarker
          key={`${layer.id}-${i}`}
          center={[feature.geometry.coordinates[1], feature.geometry.coordinates[0]]}
          radius={radius}
          pathOptions={{ color: layer.color, fillColor: layer.color, fillOpacity: opacity, weight }}
        >
          <Popup>
            <strong>{feature.properties.name}</strong>
            {feature.properties.address && <><br />{feature.properties.address}</>}
            {feature.properties.postcode && <><br />{feature.properties.postcode}</>}
          </Popup>
        </CircleMarker>
      ))
  );
}

function ZoomLabels({ data, format, property }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  const [bounds, setBounds] = useState(map.getBounds());

  useEffect(() => {
    const update = () => { setZoom(map.getZoom()); setBounds(map.getBounds()); };
    map.on("zoomend", update);
    map.on("moveend", update);
    return () => { map.off("zoomend", update); map.off("moveend", update); };
  }, [map]);

  const centroids = useMemo(() => data ? computeCentroids(data.features, property) : [], [data, property]);

  if (zoom < 14 || !data) return null;

  const visible = centroids.filter((c) => bounds.contains([c.lat, c.lng]));

  return visible.map((c, i) => (
    <Marker
      key={i}
      position={[c.lat, c.lng]}
      icon={L.divIcon({
        className: "value-label",
        html: `<span>${format(c.value)}</span>`,
        iconSize: [50, 16],
        iconAnchor: [25, 8],
      })}
      interactive={false}
    />
  ));
}

function FlyTo({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, zoom || 14, { duration: 1.5 });
  }, [center, zoom, map]);
  return null;
}

function WalkingRings({ postcodes }) {
  return postcodes.flatMap((p) =>
    WALK_RINGS.map((ring) => (
      <Circle
        key={`${p.postcode}-${ring.mins}`}
        center={[p.lat, p.lng]}
        radius={ring.meters}
        interactive={false}
        pathOptions={{
          color: ring.color,
          fillColor: ring.color,
          fillOpacity: ring.opacity,
          weight: 1.5,
          dashArray: "6 4",
          opacity: 0.5,
        }}
      />
    ))
  );
}

function TransitIsochrones({ data }) {
  // data is { postcode: { 15: [[lat,lng],...], 30: [...], 45: [...] } }
  if (!data) return null;
  const postcodes = Object.keys(data);
  return postcodes.flatMap((postcode, pcIdx) => {
    const color = TRANSIT_COLORS[pcIdx % TRANSIT_COLORS.length];
    const isochrones = data[postcode];
    return TRANSIT_RINGS.map((ring) => {
      const positions = isochrones[ring.mins];
      if (!positions || positions.length < 3) return null;
      return (
        <Polygon
          key={`transit-${postcode}-${ring.mins}`}
          positions={positions}
          interactive={false}
          pathOptions={{
            color,
            fillColor: color,
            fillOpacity: ring.opacity,
            weight: 1.5,
            dashArray: "4 4",
            opacity: 0.6,
          }}
        />
      );
    });
  });
}

/* ── Sidebar sub-components ────────────────────────────────── */

function PostcodeSearch({ onResult }) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const search = async (e) => {
    e.preventDefault();
    setError("");
    const q = query.trim().toUpperCase();
    if (!q) return;
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}`);
      if (!res.ok) { setError("Postcode not found"); return; }
      const data = await res.json();
      if (data.status === 200 && data.result) {
        onResult({
          lat: data.result.latitude,
          lng: data.result.longitude,
          postcode: data.result.postcode,
          ward: data.result.admin_ward,
          borough: data.result.admin_district,
        });
        setQuery("");
        setError("");
      } else {
        setError("Postcode not found");
      }
    } catch {
      setError("Search failed");
    }
  };

  return (
    <form className="search" onSubmit={search}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search postcode..."
        className="search-input"
      />
      <button type="submit" className="search-btn">Go</button>
      {error && <div className="search-error">{error}</div>}
    </form>
  );
}

function ScoreBar({ score, label, detail, enabled, onToggle, tip }) {
  const color = score >= 70 ? "#4ade80" : score >= 40 ? "#fbbf24" : "#f87171";
  return (
    <div
      className={`score-row ${enabled === false ? "score-disabled" : ""}`}
      onClick={onToggle}
      style={{ cursor: onToggle ? "pointer" : undefined }}
    >
      {onToggle && (
        <span className={`score-toggle ${enabled === false ? "" : "score-toggle-on"}`} />
      )}
      <span className="score-label">{label}</span>
      {tip && (
        <span
          className="score-info"
          onClick={(e) => e.stopPropagation()}
        >
          i
          <span className="score-tooltip">{tip}</span>
        </span>
      )}
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${score}%`, background: enabled === false ? "#555" : color }} />
      </div>
      <span className="score-value">{score}</span>
      {detail && <span className="score-detail">{detail}</span>}
    </div>
  );
}

function PostcodeScoreCard({ postcode, scores, expanded, onToggle, onToggleDim, onSelectAll, onDeselectAll }) {
  const overallColor = scores.overall >= 70 ? "#4ade80" : scores.overall >= 40 ? "#fbbf24" : "#f87171";
  return (
    <div className="score-card">
      <div className="score-card-header" onClick={onToggle}>
        <div className="score-card-title">
          <strong>{postcode.postcode}</strong>
          <span>{postcode.ward}, {postcode.borough}</span>
        </div>
        <div className="score-overall" style={{ borderColor: overallColor, color: overallColor }}>
          {scores.overall}
        </div>
      </div>
      {expanded && (
        <div className="score-card-body">
          <div className="score-bulk-actions">
            <button className="score-bulk-btn" onClick={onSelectAll}>All</button>
            <button className="score-bulk-btn" onClick={onDeselectAll}>None</button>
          </div>
          <div className="score-section-title">Area Quality <span className="score-hint">(click row to toggle)</span></div>
          {Object.entries(scores.area).map(([dimId, s]) => (
            <ScoreBar
              key={dimId}
              score={s.score}
              label={s.label}
              enabled={s.enabled}
              onToggle={() => onToggleDim(dimId)}
              tip={s.tip}
            />
          ))}
          <div className="score-section-title">Proximity</div>
          {Object.entries(scores.proximity).map(([dimId, s]) => (
            <ScoreBar
              key={dimId}
              score={s.score}
              label={s.label}
              detail={`${s.nearby || 0}x ${s.dist < 1000 ? `${s.dist}m` : `${(s.dist / 1000).toFixed(1)}km`}`}
              enabled={s.enabled}
              onToggle={() => onToggleDim(dimId)}
              tip={s.tip}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ComparisonBar({ values, postcodes }) {
  const max = Math.max(...values.map((v) => v.score));
  return (
    <div className="cmp-bars">
      {postcodes.map((p, i) => {
        const v = values[i];
        if (!v) return null;
        const color = v.score >= 70 ? "#4ade80" : v.score >= 40 ? "#fbbf24" : "#f87171";
        const isBest = values.length > 1 && v.score === max && values.filter((x) => x.score === max).length === 1;
        return (
          <div key={p.postcode} className="cmp-bar-row">
            <span className="cmp-pc-label">{p.postcode}</span>
            <div className="cmp-bar-track">
              <div className="cmp-bar-fill" style={{ width: `${v.score}%`, background: color }} />
            </div>
            <span className={`cmp-bar-val ${isBest ? "cmp-best" : ""}`}>{v.score}</span>
            {v.detail && <span className="cmp-bar-detail">{v.detail}</span>}
          </div>
        );
      })}
    </div>
  );
}

function ComparisonTable({ postcodes, allScores }) {
  if (postcodes.length < 2) return null;
  const sample = allScores[postcodes[0].postcode];
  if (!sample) return null;

  const areaDims = Object.entries(sample.area).map(([id, s]) => ({ id, label: s.label, type: "area" }));
  const proxDims = Object.entries(sample.proximity).map(([id, s]) => ({ id, label: s.label, type: "prox" }));

  const getValues = (dimId, type) =>
    postcodes.map((p) => {
      const scores = allScores[p.postcode];
      if (!scores) return { score: 0 };
      const bucket = type === "area" ? scores.area : scores.proximity;
      const entry = bucket[dimId];
      if (!entry) return { score: 0 };
      const detail = entry.dist != null
        ? `${entry.nearby || ""}${entry.nearby ? "x " : ""}${entry.dist < 1000 ? `${entry.dist}m` : `${(entry.dist / 1000).toFixed(1)}km`}`
        : null;
      return { score: entry.score, detail };
    });

  return (
    <div className="comparison-panel">
      {/* Overall scores */}
      <div className="cmp-section">
        <div className="cmp-section-title">Overall</div>
        <div className="cmp-overall-row">
          {postcodes.map((p) => {
            const s = allScores[p.postcode]?.overall || 0;
            const color = s >= 70 ? "#4ade80" : s >= 40 ? "#fbbf24" : "#f87171";
            return (
              <div key={p.postcode} className="cmp-overall-card">
                <div className="cmp-overall-score" style={{ borderColor: color, color }}>{s}</div>
                <div className="cmp-overall-label">{p.postcode}</div>
                <div className="cmp-overall-sub">{p.ward}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Area quality */}
      <div className="cmp-section">
        <div className="cmp-section-title">Area Quality</div>
        {areaDims.map((dim) => (
          <div key={dim.id} className="cmp-metric">
            <div className="cmp-metric-label">{dim.label}</div>
            <ComparisonBar values={getValues(dim.id, "area")} postcodes={postcodes} />
          </div>
        ))}
      </div>

      {/* Proximity */}
      <div className="cmp-section">
        <div className="cmp-section-title">Proximity</div>
        {proxDims.map((dim) => (
          <div key={dim.id} className="cmp-metric">
            <div className="cmp-metric-label">{dim.label}</div>
            <ComparisonBar values={getValues(dim.id, "prox")} postcodes={postcodes} />
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterPanel({ filters, setFilters, choroplethData }) {
  const FILTER_DIMS = [
    { id: "crime-current", label: "Max Crime Score", property: "value", max: 200 },
    { id: "air", label: "Max NO₂ (µg/m³)", property: "value", max: 80 },
    { id: "imd", label: "Max Deprivation", property: "imd", max: 60 },
  ];

  return (
    <div className="filter-panel">
      {FILTER_DIMS.map((dim) => (
        <div key={dim.id} className="filter-row">
          <label className="filter-label">
            {dim.label}
            <span className="filter-value">
              {filters[dim.id] != null ? `< ${filters[dim.id]}` : "off"}
            </span>
          </label>
          <input
            type="range"
            min={0}
            max={dim.max}
            step={1}
            value={filters[dim.id] ?? dim.max}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              setFilters((prev) => {
                const next = { ...prev };
                if (val >= dim.max) delete next[dim.id];
                else next[dim.id] = val;
                return next;
              });
            }}
            className="filter-slider"
          />
        </div>
      ))}
      {Object.keys(filters).length > 0 && (
        <button className="filter-clear" onClick={() => setFilters({})}>
          Reset filters
        </button>
      )}
    </div>
  );
}

/* ── Main App ──────────────────────────────────────────────── */

function App() {
  // Read initial state from URL
  const initialState = useMemo(() => decodeAppState(window.location.hash), []);

  const [activeLayers, setActiveLayers] = useState(
    () => new Set(initialState.layers || ["tube"])
  );
  const [activeChoropleth, setActiveChoropleth] = useState(initialState.choropleth);
  const [layerData, setLayerData] = useState({});
  const [choroplethData, setChoroplethData] = useState({});
  const [flyTarget, setFlyTarget] = useState(null);
  const [pinnedPostcodes, setPinnedPostcodes] = useState([]);
  const [choroplethOpacity, setChoroplethOpacity] = useState(initialState.opacity);
  const [showRings, setShowRings] = useState(initialState.showRings);
  const [expandedCard, setExpandedCard] = useState(null);
  const [showComparison, setShowComparison] = useState(false);
  const [filters, setFilters] = useState(initialState.filters || {});
  const [showFilters, setShowFilters] = useState(Object.keys(initialState.filters || {}).length > 0);
  const [transitData, setTransitData] = useState({});
  const [showTransit, setShowTransit] = useState(false);
  const [disabledScoreDims, setDisabledScoreDims] = useState(new Set());

  // Track if initial URL postcodes have been resolved
  const initialPostcodesRef = useRef(initialState.postcodes);

  // Load point layers
  useEffect(() => {
    POINT_LAYERS.forEach(async (layer) => {
      try {
        const res = await fetch(layer.file);
        if (!res.ok) return;
        const geojson = await res.json();
        setLayerData((prev) => ({ ...prev, [layer.id]: geojson }));
      } catch { /* skip */ }
    });
  }, []);

  // Load choropleth layers (deduplicated)
  useEffect(() => {
    const fileToLayers = {};
    for (const layer of CHOROPLETH_LAYERS) {
      if (!fileToLayers[layer.file]) fileToLayers[layer.file] = [];
      fileToLayers[layer.file].push(layer.id);
    }
    Object.entries(fileToLayers).forEach(async ([file, layerIds]) => {
      try {
        const res = await fetch(file);
        if (!res.ok) return;
        const geojson = await res.json();
        setChoroplethData((prev) => {
          const next = { ...prev };
          for (const id of layerIds) next[id] = geojson;
          return next;
        });
      } catch { /* skip */ }
    });
  }, []);

  // Resolve postcodes from URL on mount
  useEffect(() => {
    const codes = initialPostcodesRef.current;
    if (!codes.length) return;
    initialPostcodesRef.current = [];
    codes.forEach(async (code) => {
      try {
        const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(code)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 200 && data.result) {
          const result = {
            lat: data.result.latitude,
            lng: data.result.longitude,
            postcode: data.result.postcode,
            ward: data.result.admin_ward,
            borough: data.result.admin_district,
          };
          setPinnedPostcodes((prev) =>
            prev.some((p) => p.postcode === result.postcode) ? prev : [...prev, result]
          );
        }
      } catch { /* skip */ }
    });
  }, []);

  // Sync state to URL hash
  useEffect(() => {
    const hash = encodeAppState({
      postcodes: pinnedPostcodes,
      activeLayers,
      activeChoropleth,
      opacity: choroplethOpacity,
      showRings,
      filters,
    });
    window.history.replaceState(null, "", hash ? `#${hash}` : window.location.pathname);
  }, [pinnedPostcodes, activeLayers, activeChoropleth, choroplethOpacity, showRings, filters]);

  const toggleLayer = (id) => {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleChoropleth = (id) => {
    setActiveChoropleth((prev) => (prev === id ? null : id));
  };

  const featureCount = (id) => layerData[id]?.features.length || 0;

  const handlePostcodeResult = (result) => {
    if (!pinnedPostcodes.some((p) => p.postcode === result.postcode)) {
      setPinnedPostcodes((prev) => [...prev, result]);
    }
    setFlyTarget({ center: [result.lat, result.lng], zoom: 15 });
  };

  const removePostcode = (postcode) => {
    setPinnedPostcodes((prev) => prev.filter((p) => p.postcode !== postcode));
    if (expandedCard === postcode) setExpandedCard(null);
    setTransitData((prev) => { const next = { ...prev }; delete next[postcode]; return next; });
  };

  const [transitLoading, setTransitLoading] = useState(false);

  const fetchTransitIsochrones = async () => {
    setShowTransit(true);
    setTransitLoading(true);
    try {
      for (const p of pinnedPostcodes) {
        if (transitData[p.postcode]) continue;
        const iso = await computeTransitIsochrones(p.lat, p.lng);
        setTransitData((prev) => ({ ...prev, [p.postcode]: iso }));
      }
    } finally {
      setTransitLoading(false);
    }
  };

  const toggleScoreDim = (dimId) => {
    setDisabledScoreDims((prev) => {
      const next = new Set(prev);
      if (next.has(dimId)) next.delete(dimId); else next.add(dimId);
      return next;
    });
  };

  // Percentile lookups for scoring
  const percentileLookups = useMemo(() => buildPercentileLookups(choroplethData), [choroplethData]);

  // Compute scores for all pinned postcodes
  const allScores = useMemo(() => {
    const result = {};
    for (const p of pinnedPostcodes) {
      result[p.postcode] = computePostcodeScores(
        p.lat, p.lng, choroplethData, layerData, percentileLookups, disabledScoreDims
      );
    }
    return result;
  }, [pinnedPostcodes, choroplethData, layerData, percentileLookups, disabledScoreDims]);

  // Choropleth rendering
  const choroplethMeta = useMemo(() => {
    if (!activeChoropleth || !choroplethData[activeChoropleth]) return null;
    const layer = CHOROPLETH_LAYERS.find((l) => l.id === activeChoropleth);
    const scale = computeScale(choroplethData[activeChoropleth].features, layer.property);
    return { ...scale, layer };
  }, [activeChoropleth, choroplethData]);

  // Precompute filter pass/fail for features
  const filterPassSet = useMemo(() => {
    if (!Object.keys(filters).length) return null;
    const pass = new Set();
    // We need a reference dataset — use IMD or crime features
    const refData = choroplethData["imd"] || choroplethData["crime-current"];
    if (!refData) return null;

    for (const f of refData.features) {
      let passes = true;
      for (const [dimId, maxVal] of Object.entries(filters)) {
        const layer = CHOROPLETH_LAYERS.find((l) => l.id === dimId);
        if (!layer) continue;
        const data = choroplethData[dimId];
        if (!data) continue;
        // Find feature by code
        const match = data.features.find((df) => df.properties.code === f.properties.code);
        if (!match) { passes = false; break; }
        const val = match.properties[layer.property];
        if (val == null || val > maxVal) { passes = false; break; }
      }
      if (passes) pass.add(f.properties.code);
    }
    return pass;
  }, [filters, choroplethData]);

  const choroplethStyle = useCallback(
    (feature) => {
      if (!choroplethMeta) return {};
      const { min, max, layer } = choroplethMeta;
      const val = feature.properties[layer.property] || 0;
      const t = max > min ? Math.max(0, Math.min(1, (val - min) / (max - min))) : 0;

      // Apply filter dimming
      const filtered = filterPassSet && !filterPassSet.has(feature.properties.code);

      return {
        fillColor: filtered ? "#d0d0d0" : interpolateColor(layer.colorStops, t),
        fillOpacity: filtered ? 0.2 : choroplethOpacity,
        color: filtered ? "#ccc" : "#444",
        weight: 0.5,
      };
    },
    [choroplethMeta, choroplethOpacity, filterPassSet]
  );

  // When no choropleth but filters are active, show filter overlay
  const filterOnlyStyle = useCallback(
    (feature) => {
      if (!filterPassSet) return { fillOpacity: 0 };
      const passes = filterPassSet.has(feature.properties.code);
      return {
        fillColor: passes ? "#4ade80" : "#e0e0e0",
        fillOpacity: passes ? 0.35 : 0.15,
        color: passes ? "#22c55e" : "#ccc",
        weight: passes ? 1 : 0.3,
      };
    },
    [filterPassSet]
  );

  const onEachChoroplethFeature = useCallback((feature, leafletLayer) => {
    const props = feature.properties;
    const layer = choroplethMeta?.layer;
    const val = layer ? props[layer.property] : props.value;
    const formatted = layer?.format ? layer.format(val || 0) : String(val || 0);
    leafletLayer.bindPopup(
      `<strong>${props.name}</strong><br/>${props.borough ? props.borough + "<br/>" : ""}${layer ? `${layer.name}: ${formatted}` : ""}`
    );
    leafletLayer.on({
      mouseover: (e) => e.target.setStyle({ fillOpacity: 0.9, weight: 2, color: "#fff" }),
      mouseout: (e) => {
        const filtered = filterPassSet && !filterPassSet.has(props.code);
        e.target.setStyle({
          fillOpacity: filtered ? 0.2 : choroplethOpacity,
          weight: 0.5,
          color: filtered ? "#ccc" : "#444",
        });
      },
    });
  }, [choroplethMeta, choroplethOpacity, filterPassSet]);

  const activeLayer = choroplethMeta?.layer;

  // Filter overlay data (use IMD data which covers all LSOAs)
  const filterOverlayData = useMemo(() => {
    if (!filterPassSet || activeChoropleth) return null;
    return choroplethData["imd"] || choroplethData["crime-current"] || null;
  }, [filterPassSet, activeChoropleth, choroplethData]);

  // Count matching LSOAs
  const filterMatchCount = filterPassSet ? filterPassSet.size : null;

  return (
    <div className="app">
      <div className={`sidebar ${showComparison && pinnedPostcodes.length >= 2 ? "sidebar-wide" : ""}`}>
        <h1 className="logo">loclocloc</h1>
        <p className="subtitle">find your spot in London</p>

        <PostcodeSearch onResult={handlePostcodeResult} />

        {/* Pinned postcodes with scores */}
        {pinnedPostcodes.length > 0 && (
          <div className="pinned-section">
            {pinnedPostcodes.map((p) => (
              <div key={p.postcode} className="pinned-postcode-wrapper">
                {allScores[p.postcode] ? (
                  <PostcodeScoreCard
                    postcode={p}
                    scores={allScores[p.postcode]}
                    expanded={expandedCard === p.postcode}
                    onToggle={() => setExpandedCard(expandedCard === p.postcode ? null : p.postcode)}
                    onToggleDim={toggleScoreDim}
                    onSelectAll={() => setDisabledScoreDims(new Set())}
                    onDeselectAll={() => {
                      const all = new Set([
                        ...SCORE_AREA_DIMS.map((d) => d.id),
                        ...SCORE_PROX_DIMS.map((d) => d.id),
                      ]);
                      setDisabledScoreDims(all);
                    }}
                  />
                ) : (
                  <div className="pinned-postcode">
                    <div className="pinned-info">
                      <strong>{p.postcode}</strong>
                      <span>{p.ward}, {p.borough}</span>
                    </div>
                  </div>
                )}
                <button
                  className="pinned-remove"
                  onClick={() => removePostcode(p.postcode)}
                  title="Remove pin"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="pinned-actions">
              {pinnedPostcodes.length > 1 && (
                <button
                  className={`action-btn ${showComparison ? "active" : ""}`}
                  onClick={() => setShowComparison(!showComparison)}
                >
                  {showComparison ? "Hide" : "Compare"}
                </button>
              )}
              <button
                className={`action-btn ${showRings ? "active" : ""}`}
                onClick={() => setShowRings(!showRings)}
              >
                {showRings ? "Hide walk" : "Walk"}
              </button>
              <button
                className={`action-btn ${showTransit ? "active" : ""}`}
                onClick={() => {
                  if (showTransit) { setShowTransit(false); }
                  else { fetchTransitIsochrones(); }
                }}
                disabled={transitLoading}
              >
                {transitLoading ? "Loading..." : showTransit ? "Hide transit" : "Transit"}
              </button>
              <button className="action-btn" onClick={() => setPinnedPostcodes([])}>
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Comparison table */}
        {showComparison && pinnedPostcodes.length >= 2 && (
          <ComparisonTable postcodes={pinnedPostcodes} allScores={allScores} />
        )}

        <div className="layers">
          <h2>Points of Interest</h2>
          {POINT_LAYERS.map((layer) => (
            <label key={layer.id} className={`layer-toggle ${activeLayers.has(layer.id) ? "active" : ""}`}>
              <input type="checkbox" checked={activeLayers.has(layer.id)} onChange={() => toggleLayer(layer.id)} />
              <span className="layer-dot" style={{ backgroundColor: layer.color }} />
              <span className="layer-name">{layer.emoji} {layer.name}</span>
              <span className="layer-count">{featureCount(layer.id)}</span>
            </label>
          ))}
        </div>

        <div className="layers">
          <h2>Area Data (LSOA)</h2>
          {CHOROPLETH_LAYERS.map((layer) => (
            <label key={layer.id} className={`layer-toggle ${activeChoropleth === layer.id ? "active" : ""}`}>
              <input type="radio" name="choropleth" checked={activeChoropleth === layer.id} onChange={() => toggleChoropleth(layer.id)} />
              <span className="layer-name">{layer.emoji} {layer.name}</span>
            </label>
          ))}
          {activeChoropleth && (
            <button className="clear-choropleth" onClick={() => setActiveChoropleth(null)}>
              Clear overlay
            </button>
          )}
        </div>

        {/* Opacity slider */}
        {activeChoropleth && (
          <div className="opacity-control">
            <label className="opacity-label">
              Opacity
              <span>{Math.round(choroplethOpacity * 100)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(choroplethOpacity * 100)}
              onChange={(e) => setChoroplethOpacity(parseInt(e.target.value) / 100)}
              className="opacity-slider"
            />
          </div>
        )}

        {/* Legend */}
        {choroplethMeta && (
          <div className="legend">
            <div className="legend-title">
              {choroplethMeta.layer.name} ({choroplethMeta.layer.unit})
            </div>
            <div className="legend-bar">
              {choroplethMeta.layer.colorStops.map((color, i) => (
                <div key={i} className="legend-stop" style={{ backgroundColor: color }} />
              ))}
            </div>
            <div className="legend-labels">
              <span>{choroplethMeta.layer.format(choroplethMeta.min)}</span>
              <span>{choroplethMeta.layer.format(choroplethMeta.max)}</span>
            </div>
          </div>
        )}

        {/* Filter panel */}
        <div className="layers">
          <h2
            className="filter-toggle-header"
            onClick={() => setShowFilters(!showFilters)}
          >
            Filter Areas {filterMatchCount != null && `(${filterMatchCount} match)`}
            <span className="filter-chevron">{showFilters ? "▾" : "▸"}</span>
          </h2>
          {showFilters && (
            <FilterPanel
              filters={filters}
              setFilters={setFilters}
              choroplethData={choroplethData}
            />
          )}
        </div>

        <div className="info">
          <p>Pin postcodes to score and compare. Toggle layers to explore London.</p>
        </div>
      </div>

      <MapContainer
        center={LONDON_CENTER}
        zoom={LONDON_ZOOM}
        className="map"
        zoomControl={false}
        preferCanvas
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />

        {flyTarget && <FlyTo center={flyTarget.center} zoom={flyTarget.zoom} />}

        {/* Filter-only overlay (when no choropleth active but filters set) */}
        {filterOverlayData && (
          <GeoJSON
            key={`filter-${JSON.stringify(filters)}`}
            data={filterOverlayData}
            style={filterOnlyStyle}
          />
        )}

        {/* Choropleth layer */}
        {activeChoropleth && choroplethData[activeChoropleth] && (
          <>
            <GeoJSON
              key={`${activeChoropleth}-${JSON.stringify(filters)}-${choroplethOpacity}`}
              data={choroplethData[activeChoropleth]}
              style={choroplethStyle}
              onEachFeature={onEachChoroplethFeature}
            />
            <ZoomLabels
              data={choroplethData[activeChoropleth]}
              format={activeLayer?.format || String}
              property={activeLayer?.property || "value"}
            />
          </>
        )}

        {/* Walking distance rings */}
        {showRings && <WalkingRings postcodes={pinnedPostcodes} />}

        {/* Transit isochrones */}
        {showTransit && <TransitIsochrones data={transitData} />}

        <PointMarkers layers={POINT_LAYERS} activeLayers={activeLayers} layerData={layerData} />

        {pinnedPostcodes.map((p) => (
          <Marker
            key={p.postcode}
            position={[p.lat, p.lng]}
            icon={L.divIcon({
              className: "postcode-pin",
              html: `<div class="pin-marker"><span>${p.postcode}</span></div>`,
              iconSize: [80, 36],
              iconAnchor: [40, 36],
            })}
          >
            <Popup>
              <strong>{p.postcode}</strong><br />
              {p.ward}, {p.borough}
              {allScores[p.postcode] && (
                <><br />Overall score: <strong>{allScores[p.postcode].overall}/100</strong></>
              )}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

export default App;
