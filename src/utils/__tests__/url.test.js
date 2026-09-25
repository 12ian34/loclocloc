import { describe, it, expect } from "vitest";
import { encodeAppState, decodeAppState } from "../url.js";

const base = {
  postcodes: [],
  activeLayers: new Set(),
  activeChoropleth: null,
  opacity: 0.65,
  showRings: false,
  filters: {},
  disabledScoreDims: new Set(),
  showTransit: false,
};

describe("url state", () => {
  it("encodes nothing for the default state", () => {
    expect(encodeAppState(base)).toBe("");
  });

  it("round-trips every field", () => {
    const state = {
      ...base,
      postcodes: [{ postcode: "N1 9GU" }, { postcode: "SW1A 1AA" }],
      activeLayers: new Set(["tube", "pubs"]),
      activeChoropleth: "imd",
      opacity: 0.4,
      showRings: true,
      filters: { "crime-current": 40, ptal: 10 },
      disabledScoreDims: new Set(["betting"]),
      showTransit: true,
    };
    const hash = encodeAppState(state);
    const decoded = decodeAppState(`#${hash}`);
    expect(decoded.postcodes).toEqual(["N19GU", "SW1A1AA"]);
    expect(decoded.layers).toEqual(["tube", "pubs"]);
    expect(decoded.choropleth).toBe("imd");
    expect(decoded.opacity).toBeCloseTo(0.4);
    expect(decoded.showRings).toBe(true);
    expect(decoded.filters).toEqual({ "crime-current": 40, ptal: 10 });
    expect(decoded.disabledScoreDims).toEqual(["betting"]);
    expect(decoded.showTransit).toBe(true);
  });

  it("falls back to defaults on malformed input", () => {
    const decoded = decodeAppState("#f=%7Bnot-json");
    expect(decoded.filters).toEqual({});
    expect(decoded.opacity).toBe(0.65);
    expect(decoded.layers).toBeNull();
  });
});
