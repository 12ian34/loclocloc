import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, GeoJSON } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

import {
  GITHUB_REPO_URL,
  LONDON_CENTER,
  LONDON_ZOOM,
  POINT_LAYERS,
  CHOROPLETH_LAYERS,
  SCORE_AREA_DIMS,
  SCORE_PROX_DIMS,
} from "./config.js";
import { interpolateColor, computeScale, buildPercentileLookups, computePostcodeScores } from "./utils/geo.js";
import { encodeAppState, decodeAppState } from "./utils/url.js";
import { computeTransitIsochrones } from "./utils/tfl.js";
import { PointMarkers, ZoomLabels, FlyTo, WalkingRings, TransitIsochrones, ChoroplethLayer } from "./components/MapLayers.jsx";
import {
  PostcodeSearch,
  PostcodeScoreCard,
  ComparisonTable,
  DataAboutModal,
  FilterPanel,
  SidebarFooter,
} from "./components/Sidebar.jsx";

// #3: keyboard handler for accessible interactive elements
function onKeyActivate(callback) {
  return (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      callback();
    }
  };
}

function App() {
  const initialState = useMemo(() => decodeAppState(window.location.hash), []);

  const [activeLayers, setActiveLayers] = useState(
    () => new Set(initialState.layers ?? [])
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
  const [showFilters, setShowFilters] = useState(true);
  const [showPoiSection, setShowPoiSection] = useState(true);
  const [showAreaSection, setShowAreaSection] = useState(true);
  const [transitData, setTransitData] = useState({});
  const [showTransit, setShowTransit] = useState(initialState.showTransit);
  // #6: restore disabled dims from URL
  const [disabledScoreDims, setDisabledScoreDims] = useState(
    () => new Set(initialState.disabledScoreDims ?? [])
  );
  const [showDataModal, setShowDataModal] = useState(false);
  const [shareTip, setShareTip] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // #4: loading state for initial data
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setShowDataModal(false);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const copyShareUrl = useCallback(async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setShareTip("Link copied");
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setShareTip("Link copied");
      } catch {
        setShareTip("Copy blocked \u2014 copy the URL from the bar");
      }
    }
    window.setTimeout(() => setShareTip(""), 2800);
    setMobileMenuOpen(false);
  }, []);

  const initialPostcodesRef = useRef(initialState.postcodes);

  // #4: Load point layers with loading tracking
  useEffect(() => {
    let pointDone = false;
    let choroDone = false;

    const checkDone = () => {
      if (pointDone && choroDone) setDataLoading(false);
    };

    // Load point layers
    const pointPromises = POINT_LAYERS.map(async (layer) => {
      try {
        const res = await fetch(layer.file);
        if (!res.ok) return;
        const geojson = await res.json();
        setLayerData((prev) => ({ ...prev, [layer.id]: geojson }));
      } catch { /* skip */ }
    });
    Promise.all(pointPromises).then(() => { pointDone = true; checkDone(); });

    // Load choropleth layers (deduplicated)
    const fileToLayers = {};
    for (const layer of CHOROPLETH_LAYERS) {
      if (!fileToLayers[layer.file]) fileToLayers[layer.file] = [];
      fileToLayers[layer.file].push(layer.id);
    }
    const choroPromises = Object.entries(fileToLayers).map(async ([file, layerIds]) => {
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
    Promise.all(choroPromises).then(() => { choroDone = true; checkDone(); });
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

  // #6: Sync state to URL hash (now includes disabledScoreDims + showTransit)
  useEffect(() => {
    const hash = encodeAppState({
      postcodes: pinnedPostcodes,
      activeLayers,
      activeChoropleth,
      opacity: choroplethOpacity,
      showRings,
      filters,
      disabledScoreDims,
      showTransit,
    });
    window.history.replaceState(null, "", hash ? `#${hash}` : window.location.pathname);
  }, [pinnedPostcodes, activeLayers, activeChoropleth, choroplethOpacity, showRings, filters, disabledScoreDims, showTransit]);

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

  // #5: clear flyTarget after animation
  const clearFlyTarget = useCallback(() => setFlyTarget(null), []);

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

  const percentileLookups = useMemo(() => buildPercentileLookups(choroplethData), [choroplethData]);

  const allScores = useMemo(() => {
    const result = {};
    for (const p of pinnedPostcodes) {
      result[p.postcode] = computePostcodeScores(
        p.lat, p.lng, choroplethData, layerData, percentileLookups, disabledScoreDims
      );
    }
    return result;
  }, [pinnedPostcodes, choroplethData, layerData, percentileLookups, disabledScoreDims]);

  const choroplethMeta = useMemo(() => {
    if (!activeChoropleth || !choroplethData[activeChoropleth]) return null;
    const layer = CHOROPLETH_LAYERS.find((l) => l.id === activeChoropleth);
    const scale = computeScale(choroplethData[activeChoropleth].features, layer.property);
    return { ...scale, layer };
  }, [activeChoropleth, choroplethData]);

  // #1: Build code->feature lookup maps for filter dimensions (O(n) instead of O(n^2))
  const filterCodeMaps = useMemo(() => {
    if (!Object.keys(filters).length) return null;
    const maps = {};
    for (const dimId of Object.keys(filters)) {
      const data = choroplethData[dimId];
      if (!data) continue;
      const m = new Map();
      for (const f of data.features) {
        m.set(f.properties.code, f);
      }
      maps[dimId] = m;
    }
    return maps;
  }, [filters, choroplethData]);

  // #1: filterPassSet using pre-built maps
  const filterPassSet = useMemo(() => {
    if (!Object.keys(filters).length || !filterCodeMaps) return null;
    const pass = new Set();
    const refData = choroplethData["imd"] || choroplethData["crime-current"];
    if (!refData) return null;

    for (const f of refData.features) {
      let passes = true;
      for (const [dimId, maxVal] of Object.entries(filters)) {
        const layer = CHOROPLETH_LAYERS.find((l) => l.id === dimId);
        if (!layer) continue;
        const codeMap = filterCodeMaps[dimId];
        if (!codeMap) { passes = false; break; }
        const match = codeMap.get(f.properties.code);
        if (!match) { passes = false; break; }
        const val = match.properties[layer.property];
        if (val == null || val > maxVal) { passes = false; break; }
      }
      if (passes) pass.add(f.properties.code);
    }
    return pass;
  }, [filters, choroplethData, filterCodeMaps]);

  // #2: choropleth style — called imperatively, no longer forces remount on opacity
  const choroplethStyle = useCallback(
    (feature) => {
      if (!choroplethMeta) return {};
      const { min, max, layer } = choroplethMeta;
      const val = feature.properties[layer.property] || 0;
      const t = max > min ? Math.max(0, Math.min(1, (val - min) / (max - min))) : 0;
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

  // #2: use ref for opacity in mouseout so events stay fresh without remount
  const opacityRef = useRef(choroplethOpacity);
  opacityRef.current = choroplethOpacity;
  const filterPassSetRef = useRef(filterPassSet);
  filterPassSetRef.current = filterPassSet;

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
        const filtered = filterPassSetRef.current && !filterPassSetRef.current.has(props.code);
        e.target.setStyle({
          fillOpacity: filtered ? 0.2 : opacityRef.current,
          weight: 0.5,
          color: filtered ? "#ccc" : "#444",
        });
      },
    });
  }, [choroplethMeta]);

  const activeLayer = choroplethMeta?.layer;

  const filterOverlayData = useMemo(() => {
    if (!filterPassSet || activeChoropleth) return null;
    return choroplethData["imd"] || choroplethData["crime-current"] || null;
  }, [filterPassSet, activeChoropleth, choroplethData]);

  const filterMatchCount = filterPassSet ? filterPassSet.size : null;

  // #2: remount key for structural changes only (not opacity)
  const choroplethRemountKey = `${activeChoropleth}-${JSON.stringify(filters)}`;

  return (
    <div className={`app ${mobileMenuOpen ? "app--menu-open" : ""}`}>
      <button
        type="button"
        className="mobile-menu-btn"
        aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
        aria-expanded={mobileMenuOpen}
        onClick={() => setMobileMenuOpen((o) => !o)}
      >
        {mobileMenuOpen ? "\u2715" : "\u2630"}
      </button>
      <button
        type="button"
        className="mobile-scrim"
        aria-label="Close menu"
        tabIndex={-1}
        onClick={() => setMobileMenuOpen(false)}
      />

      <div className={`sidebar ${showComparison && pinnedPostcodes.length >= 2 ? "sidebar-wide" : ""}`}>
        <h1 className="logo">loclocloc</h1>
        <p className="subtitle">find your spot in London</p>

        <PostcodeSearch onResult={handlePostcodeResult} />

        {/* #4: loading indicator */}
        {dataLoading && (
          <div className="loading-banner">Loading map data...</div>
        )}

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

        {showComparison && pinnedPostcodes.length >= 2 && (
          <ComparisonTable postcodes={pinnedPostcodes} allScores={allScores} />
        )}

        <div className="layers">
          {/* #3: accessible collapsible header */}
          <h2
            className="filter-toggle-header"
            onClick={() => setShowPoiSection(!showPoiSection)}
            onKeyDown={onKeyActivate(() => setShowPoiSection(!showPoiSection))}
            tabIndex={0}
            role="button"
            aria-expanded={showPoiSection}
          >
            Points of Interest
            <span className="filter-chevron">{showPoiSection ? "\u25be" : "\u25b8"}</span>
          </h2>
          {showPoiSection &&
            POINT_LAYERS.map((layer) => (
              <label key={layer.id} className={`layer-toggle ${activeLayers.has(layer.id) ? "active" : ""}`}>
                <input type="checkbox" checked={activeLayers.has(layer.id)} onChange={() => toggleLayer(layer.id)} />
                <span className="layer-dot" style={{ backgroundColor: layer.color }} />
                <span className="layer-name">{layer.emoji} {layer.name}</span>
                <span className="layer-count">{featureCount(layer.id)}</span>
              </label>
            ))}
        </div>

        <div className="layers">
          {/* #3: accessible collapsible header */}
          <h2
            className="filter-toggle-header"
            onClick={() => setShowAreaSection(!showAreaSection)}
            onKeyDown={onKeyActivate(() => setShowAreaSection(!showAreaSection))}
            tabIndex={0}
            role="button"
            aria-expanded={showAreaSection}
          >
            Area Data (LSOA)
            <span className="filter-chevron">{showAreaSection ? "\u25be" : "\u25b8"}</span>
          </h2>
          {showAreaSection && (
            <>
              {CHOROPLETH_LAYERS.map((layer) => (
                <label
                  key={layer.id}
                  className={`layer-toggle ${activeChoropleth === layer.id ? "active" : ""}`}
                  // #7: only run deselect handler on the active choropleth
                  onMouseDown={activeChoropleth === layer.id ? (e) => {
                    e.preventDefault();
                    setActiveChoropleth(null);
                  } : undefined}
                >
                  <input
                    type="radio"
                    name="choropleth"
                    checked={activeChoropleth === layer.id}
                    onChange={() => toggleChoropleth(layer.id)}
                  />
                  <span className="layer-name">{layer.emoji} {layer.name}</span>
                </label>
              ))}
              {activeChoropleth && (
                <button className="clear-choropleth" onClick={() => setActiveChoropleth(null)}>
                  Clear overlay
                </button>
              )}
            </>
          )}
        </div>

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

        <div className="layers">
          {/* #3: accessible collapsible header */}
          <h2
            className="filter-toggle-header"
            onClick={() => setShowFilters(!showFilters)}
            onKeyDown={onKeyActivate(() => setShowFilters(!showFilters))}
            tabIndex={0}
            role="button"
            aria-expanded={showFilters}
          >
            Filter Areas {filterMatchCount != null && `(${filterMatchCount} match)`}
            <span className="filter-chevron">{showFilters ? "\u25be" : "\u25b8"}</span>
          </h2>
          {showFilters && (
            <FilterPanel filters={filters} setFilters={setFilters} />
          )}
        </div>

        <SidebarFooter
          onCopyShare={copyShareUrl}
          onShowData={() => setShowDataModal(true)}
          shareTip={shareTip}
          githubUrl={GITHUB_REPO_URL}
        />

        <div className="info">
          <p>Pin postcodes to score and compare. Toggle layers to explore London.</p>
        </div>
      </div>

      {showDataModal && <DataAboutModal onClose={() => setShowDataModal(false)} />}

      <div className="map-shell">
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

        {/* #5: FlyTo now clears itself */}
        {flyTarget && <FlyTo center={flyTarget.center} zoom={flyTarget.zoom} onComplete={clearFlyTarget} />}

        {filterOverlayData && (
          <GeoJSON
            key={`filter-${JSON.stringify(filters)}`}
            data={filterOverlayData}
            style={filterOnlyStyle}
          />
        )}

        {/* #2: ChoroplethLayer uses imperative style updates */}
        {activeChoropleth && choroplethData[activeChoropleth] && (
          <>
            <ChoroplethLayer
              data={choroplethData[activeChoropleth]}
              styleFn={choroplethStyle}
              onEachFeature={onEachChoroplethFeature}
              remountKey={choroplethRemountKey}
            />
            <ZoomLabels
              data={choroplethData[activeChoropleth]}
              format={activeLayer?.format || String}
              property={activeLayer?.property || "value"}
            />
          </>
        )}

        {showRings && <WalkingRings postcodes={pinnedPostcodes} />}

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
    </div>
  );
}

export default App;
