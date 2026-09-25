/**
 * Shared writers for bundled data. Every scraper ends by calling one of these so
 * the client and `scripts/build-manifest.js` can rely on one shape per layer kind.
 *
 * Point layer (`public/data/<id>.geojson`):
 *   { type: "FeatureCollection", meta: { id, source, vintage, generated, count }, features }
 *   Minified; coordinates rounded to 5 dp (~1 m).
 *
 * Area layer (`public/data/<id>.json`):
 *   { meta: { id, source, vintage, generated, count, properties: [...] }, values: { [lsoaCode]: number | object } }
 *   Geometry is NOT repeated — the client joins values onto `lsoa-boundaries.geojson` by `code`.
 *   With one property the value is a bare number; with several it is an object keyed by property.
 */

import { writeFileSync } from "fs";
import { basename } from "path";

const today = () => new Date().toISOString().slice(0, 10);

function roundCoords(c) {
  if (typeof c === "number") return Math.round(c * 1e5) / 1e5;
  return c.map(roundCoords);
}

export function writePointLayer(path, features, meta = {}) {
  const out = {
    type: "FeatureCollection",
    meta: { id: basename(path, ".geojson"), generated: today(), count: features.length, ...meta },
    features: features.map((f) => ({ ...f, geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates) } })),
  };
  writeFileSync(path, JSON.stringify(out));
  return out.meta;
}

export function writeAreaLayer(path, lsoas, { properties = ["value"], ...meta } = {}) {
  const values = {};
  for (const f of lsoas.features) {
    const p = f.properties;
    values[p.code] = properties.length === 1
      ? p[properties[0]]
      : Object.fromEntries(properties.map((k) => [k, p[k]]));
  }
  const out = {
    meta: { id: basename(path, ".json"), generated: today(), count: Object.keys(values).length, properties, ...meta },
    values,
  };
  writeFileSync(path, JSON.stringify(out));
  return out.meta;
}
