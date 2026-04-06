import { CHOROPLETH_LAYERS, SCORE_AREA_DIMS, SCORE_PROX_DIMS } from "../config.js";

export function interpolateColor(stops, t) {
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

export function computeScale(features, property = "value") {
  const values = features.map((f) => f.properties[property]).filter((v) => v > 0).sort((a, b) => a - b);
  const p5 = values[Math.floor(values.length * 0.05)];
  const p95 = values[Math.floor(values.length * 0.95)];
  return { min: p5, max: p95 };
}

export function computeCentroids(features, property = "value") {
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

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInPolygon(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = [ring[i][1], ring[i][0]];
    const [xj, yj] = [ring[j][1], ring[j][0]];
    if (yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
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

export function findLSOAForPoint(lat, lng, features) {
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

function percentileRank(value, sortedValues) {
  let low = 0, high = sortedValues.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sortedValues[mid] < value) low = mid + 1;
    else high = mid;
  }
  return (low / sortedValues.length) * 100;
}

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

export function buildPercentileLookups(choroplethData) {
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

export function computePostcodeScores(lat, lng, choroplethData, layerData, percentileLookups, disabledDims) {
  const scores = { area: {}, proximity: {}, overall: 0 };
  let total = 0;
  let count = 0;

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
    const pct = percentileRank(rawValue, sorted);
    // inverse: false means higher raw value = better (e.g. PTAL, green space)
    const score = dim.inverse === false ? Math.round(pct) : Math.round(100 - pct);
    const enabled = !disabledDims.has(dim.id);
    scores.area[dim.id] = { score, raw: rawValue, label: dim.label, enabled, tip: dim.tip };
    if (enabled) { total += score; count++; }
  }

  for (const dim of SCORE_PROX_DIMS) {
    const features = layerData[dim.pointLayer]?.features;
    if (!features || features.length === 0) continue;
    const { score: rawScore, nearest, count: nearby } = densityProximityScore(lat, lng, features, dim.cap);
    const score = dim.inverse ? Math.max(0, 100 - rawScore) : rawScore;
    const enabled = !disabledDims.has(dim.id);
    scores.proximity[dim.id] = { score, dist: nearest, nearby, label: dim.label, enabled, tip: dim.tip };
    if (enabled) { total += score; count++; }
  }

  scores.overall = count > 0 ? Math.round(total / count) : 0;
  return scores;
}
