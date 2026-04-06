// #6: encode/decode now includes disabled score dims (d) and transit visibility (t)

export function encodeAppState({ postcodes, activeLayers, activeChoropleth, opacity, showRings, filters, disabledScoreDims, showTransit }) {
  const params = new URLSearchParams();
  if (postcodes.length) params.set("p", postcodes.map((p) => p.postcode.replace(/\s/g, "")).join(","));
  if (activeLayers.size) params.set("l", [...activeLayers].join(","));
  if (activeChoropleth) params.set("c", activeChoropleth);
  if (opacity !== 0.65) params.set("o", opacity.toFixed(2));
  if (showRings) params.set("r", "1");
  if (filters && Object.keys(filters).length) params.set("f", JSON.stringify(filters));
  if (disabledScoreDims && disabledScoreDims.size) params.set("d", [...disabledScoreDims].join(","));
  if (showTransit) params.set("t", "1");
  return params.toString();
}

export function decodeAppState(hash) {
  try {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    return {
      postcodes: params.get("p")?.split(",").filter(Boolean) || [],
      layers: params.get("l")?.split(",").filter(Boolean) || null,
      choropleth: params.get("c") || null,
      opacity: params.has("o") ? parseFloat(params.get("o")) : 0.65,
      showRings: params.get("r") === "1",
      filters: params.has("f") ? JSON.parse(params.get("f")) : {},
      disabledScoreDims: params.get("d")?.split(",").filter(Boolean) || [],
      showTransit: params.get("t") === "1",
    };
  } catch {
    return { postcodes: [], layers: null, choropleth: null, opacity: 0.65, showRings: false, filters: {}, disabledScoreDims: [], showTransit: false };
  }
}
