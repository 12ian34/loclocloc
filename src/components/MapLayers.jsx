import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Circle,
  Polygon,
  Popup,
  GeoJSON,
  Marker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { WALK_RINGS, TRANSIT_RINGS, TRANSIT_COLORS } from "../config.js";
import { computeCentroids } from "../utils/geo.js";

// Compute emoji size from zoom level — small dots at low zoom, readable emoji at high zoom
function emojiSize(zoom) {
  if (zoom <= 10) return 10;
  if (zoom <= 12) return 14;
  if (zoom <= 14) return 18;
  if (zoom <= 16) return 22;
  return 26;
}

export function PointMarkers({ layers, activeLayers, layerData }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => map.off("zoomend", onZoom);
  }, [map]);

  const size = emojiSize(zoom);

  // Cache divIcon instances per layer+zoom so we don't recreate thousands every render
  const iconCache = useMemo(() => {
    const cache = {};
    for (const layer of layers) {
      cache[layer.id] = L.divIcon({
        className: "poi-emoji-icon",
        html: `<span style="font-size:${size}px;line-height:1">${layer.emoji}</span>`,
        iconSize: [size + 4, size + 4],
        iconAnchor: [(size + 4) / 2, (size + 4) / 2],
      });
    }
    return cache;
  }, [layers, size]);

  return layers.map(
    (layer) =>
      activeLayers.has(layer.id) &&
      layerData[layer.id]?.features.map((feature, i) => (
        <Marker
          key={`${layer.id}-${i}`}
          position={[feature.geometry.coordinates[1], feature.geometry.coordinates[0]]}
          icon={iconCache[layer.id]}
        >
          <Popup>
            <strong>{feature.properties.name}</strong>
            {feature.properties.address && <><br />{feature.properties.address}</>}
            {feature.properties.postcode && <><br />{feature.properties.postcode}</>}
          </Popup>
        </Marker>
      ))
  );
}

export function ZoomLabels({ data, format, property }) {
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

// #5: FlyTo clears itself after animation completes
export function FlyTo({ center, zoom, onComplete }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom || 14, { duration: 1.5 });
      const handler = () => onComplete?.();
      map.once("moveend", handler);
      return () => map.off("moveend", handler);
    }
  }, [center, zoom, map, onComplete]);
  return null;
}

export function WalkingRings({ postcodes }) {
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

export function TransitIsochrones({ data }) {
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

// #2: ChoroplethLayer updates style imperatively instead of remounting on opacity change
export function ChoroplethLayer({ data, styleFn, onEachFeature, remountKey }) {
  const geoJsonRef = useRef(null);
  const styleFnRef = useRef(styleFn);
  const onEachRef = useRef(onEachFeature);

  // Keep refs in sync via effect (not during render)
  useEffect(() => { styleFnRef.current = styleFn; }, [styleFn]);
  useEffect(() => { onEachRef.current = onEachFeature; }, [onEachFeature]);

  // Update styles imperatively when styleFn changes (e.g. opacity slider)
  useEffect(() => {
    if (geoJsonRef.current) {
      geoJsonRef.current.eachLayer((layer) => {
        layer.setStyle(styleFnRef.current(layer.feature));
      });
    }
  }, [styleFn]);

  const stableOnEach = useCallback((feature, layer) => {
    onEachRef.current(feature, layer);
  }, []);

  return (
    <GeoJSON
      ref={geoJsonRef}
      key={remountKey}
      data={data}
      style={styleFn}
      onEachFeature={stableOnEach}
    />
  );
}
