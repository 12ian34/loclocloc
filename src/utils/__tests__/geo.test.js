import { describe, it, expect } from "vitest";
import { interpolateColor, computeScale, findLSOAForPoint, haversine, buildPercentileLookups, computePostcodeScores } from "../geo.js";
import { mergeAreaLayer } from "../data.js";
import { boundaries } from "./data.test.js";
import { SCORE_AREA_DIMS, SCORE_PROX_DIMS } from "../../config.js";

describe("interpolateColor", () => {
  it("returns the end stops at 0 and 1 and clamps outside", () => {
    const stops = ["#000000", "#ffffff"];
    expect(interpolateColor(stops, 0)).toBe("#000000");
    expect(interpolateColor(stops, 1)).toBe("#ffffff");
    expect(interpolateColor(stops, 2)).toBe("#ffffff");
    expect(interpolateColor(stops, 0.5)).toBe("#808080");
  });
});

describe("computeScale", () => {
  it("uses the 5th and 95th percentiles of positive values", () => {
    const features = Array.from({ length: 100 }, (_, i) => ({ properties: { value: i + 1 } }));
    expect(computeScale(features)).toEqual({ min: 6, max: 96 });
  });
});

describe("haversine", () => {
  it("measures roughly 1.1 km per 0.01 degree of latitude", () => {
    expect(haversine(51.5, -0.1, 51.51, -0.1)).toBeCloseTo(1112, -1);
  });
});

describe("findLSOAForPoint", () => {
  it("finds the containing polygon, else the nearest centroid", () => {
    expect(findLSOAForPoint(51.505, -0.095, boundaries.features).properties.code).toBe("E01000001");
    expect(findLSOAForPoint(51.505, -0.085, boundaries.features).properties.code).toBe("E01000002");
    expect(findLSOAForPoint(51.9, -0.07, boundaries.features).properties.code).toBe("E01000003");
  });
});

describe("computePostcodeScores", () => {
  // Three LSOAs with crime 1 < 5 < 9: the least-crime area should score highest.
  const crime = mergeAreaLayer(boundaries, { meta: { properties: ["value"] }, values: { E01000001: 1, E01000002: 5, E01000003: 9 } });
  const ptal = mergeAreaLayer(boundaries, { meta: { properties: ["value"] }, values: { E01000001: 2, E01000002: 10, E01000003: 20 } });
  const choroplethData = { "crime-current": crime, ptal };
  const lookups = buildPercentileLookups(choroplethData);
  const point = (lng) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lng, 51.505] }, properties: { name: "x" } });
  const layerData = { tube: { features: [point(-0.095), point(-0.0951)] }, betting: { features: [point(-0.095)] } };

  it("scores lower-is-better dims by inverse percentile and higher-is-better by percentile", () => {
    const s = computePostcodeScores(51.505, -0.095, choroplethData, layerData, lookups, new Set(), boundaries);
    expect(s.area["crime-current"].score).toBe(100);
    expect(s.area["crime-current"].raw).toBe(1);
    expect(s.area.ptal.score).toBe(0);
    const worst = computePostcodeScores(51.505, -0.075, choroplethData, layerData, lookups, new Set(), boundaries);
    expect(worst.area["crime-current"].score).toBeLessThan(s.area["crime-current"].score);
    expect(worst.area.ptal.score).toBeGreaterThan(s.area.ptal.score);
  });

  it("gives proximity credit for nearby points and inverts 'no betting'", () => {
    const s = computePostcodeScores(51.505, -0.095, choroplethData, layerData, lookups, new Set(), boundaries);
    expect(s.proximity.tube.score).toBeGreaterThan(0);
    expect(s.proximity.tube.nearby).toBe(2);
    expect(s.proximity.betting.score).toBeLessThan(100);
    expect(Object.keys(s.proximity)).toEqual(["tube", "betting"]);
  });

  it("excludes disabled dims from the overall mean but still reports them", () => {
    const all = computePostcodeScores(51.505, -0.095, choroplethData, layerData, lookups, new Set(), boundaries);
    const disabled = new Set(["crime-current", "ptal", "betting"]);
    const only = computePostcodeScores(51.505, -0.095, choroplethData, layerData, lookups, disabled, boundaries);
    expect(only.area["crime-current"].enabled).toBe(false);
    expect(only.overall).toBe(only.proximity.tube.score);
    expect(all.overall).not.toBe(only.overall);
  });

  it("only scores dims that are configured", () => {
    const ids = new Set([...SCORE_AREA_DIMS, ...SCORE_PROX_DIMS].map((d) => d.id));
    const s = computePostcodeScores(51.505, -0.095, choroplethData, layerData, lookups, new Set(), boundaries);
    for (const id of [...Object.keys(s.area), ...Object.keys(s.proximity)]) expect(ids.has(id)).toBe(true);
  });
});
