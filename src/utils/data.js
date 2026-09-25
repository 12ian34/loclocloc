/**
 * Bundled-data loaders. Shapes are defined in scrapers/lib/output.js:
 *  - /data/lsoa-boundaries.geojson  — 4,994 London LSOA polygons (code, name, borough)
 *  - /data/<area>.json              — { meta, values: { [code]: number | object } }
 *  - /data/<poi>.geojson            — { type, meta, features }
 *  - /data/manifest.json            — { generated, layers: { [id]: meta } } built by scripts/build-manifest.js
 */

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export const loadBoundaries = () => fetchJson("/data/lsoa-boundaries.geojson");
export const loadPointLayer = (file) => fetchJson(file);
export const loadAreaTable = (file) => fetchJson(file);
export const loadManifest = () => fetchJson("/data/manifest.json").catch(() => null);

/**
 * Join an area value table onto the boundary polygons. Returns a FeatureCollection whose
 * features share geometry objects with `boundaries` (cheap) plus `byCode` for O(1) lookups.
 */
export function mergeAreaLayer(boundaries, table) {
  const properties = table?.meta?.properties ?? ["value"];
  const single = properties.length === 1;
  const values = table?.values ?? {};
  const byCode = new Map();
  const features = boundaries.features.map((f) => {
    const v = values[f.properties.code];
    const extra = v == null ? {} : single ? { [properties[0]]: v } : v;
    const props = { ...f.properties, ...extra };
    byCode.set(props.code, props);
    return { type: "Feature", geometry: f.geometry, properties: props };
  });
  return { type: "FeatureCollection", features, byCode, meta: table?.meta ?? null };
}
