import { describe, it, expect } from "vitest";
import { mergeAreaLayer } from "../data.js";

const square = (x, y) => ({
  type: "Polygon",
  coordinates: [[[x, y], [x + 0.01, y], [x + 0.01, y + 0.01], [x, y + 0.01], [x, y]]],
});

export const boundaries = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: square(-0.1, 51.5), properties: { code: "E01000001", name: "A 001A", borough: "A" } },
    { type: "Feature", geometry: square(-0.09, 51.5), properties: { code: "E01000002", name: "A 001B", borough: "A" } },
    { type: "Feature", geometry: square(-0.08, 51.5), properties: { code: "E01000003", name: "B 001A", borough: "B" } },
  ],
};

describe("mergeAreaLayer", () => {
  it("joins single-value tables as `value` and keeps boundary props", () => {
    const merged = mergeAreaLayer(boundaries, { meta: { properties: ["value"] }, values: { E01000001: 5, E01000002: 9 } });
    expect(merged.features).toHaveLength(3);
    expect(merged.features[0].properties).toEqual({ code: "E01000001", name: "A 001A", borough: "A", value: 5 });
    expect(merged.features[2].properties.value).toBeUndefined();
    expect(merged.byCode.get("E01000002").value).toBe(9);
    expect(merged.features[0].geometry).toBe(boundaries.features[0].geometry);
  });

  it("spreads multi-property tables", () => {
    const merged = mergeAreaLayer(boundaries, { meta: { properties: ["imd", "income"] }, values: { E01000003: { imd: 30.1, income: 0.2 } } });
    expect(merged.byCode.get("E01000003")).toMatchObject({ imd: 30.1, income: 0.2, borough: "B" });
  });

  it("tolerates a missing table", () => {
    const merged = mergeAreaLayer(boundaries, null);
    expect(merged.features[0].properties.value).toBeUndefined();
    expect(merged.meta).toBeNull();
  });
});
