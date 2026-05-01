import {
  DrawLineStringMode,
  EditableGeoJsonLayer,
  ModifyMode,
  ViewMode,
} from "@deck.gl-community/editable-layers";
import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import type { Feature, FeatureCollection, GeoJsonProperties, LineString } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MutableRefObject } from "react";
import { useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import { INITIAL_LINES } from "./data/initial-lines.js";

type AnyFeatureCollection = FeatureCollection;
type EditableFeatureCollection = FeatureCollection<LineString>;
type EditableFeature = Feature<LineString>;

type SaveCenterlinesPayload = {
  featureCollection: EditableFeatureCollection;
  metadata: {
    rasterUrl?: string;
    crs?: "EPSG:4326";
    runId?: string;
    notes?: string;
  };
};

type EditModeKey = "view" | "modify" | "drawLine";

const EDIT_MODES: Record<
  EditModeKey,
  typeof ViewMode | typeof ModifyMode | typeof DrawLineStringMode
> = {
  view: ViewMode,
  modify: ModifyMode,
  drawLine: DrawLineStringMode,
};

const DEFAULT_COG_URL =
  "https://ds-wheels.s3.us-east-1.amazonaws.com/m_4007307_sw_18_060_20220803.tif";

export async function saveToBackend(payload: SaveCenterlinesPayload): Promise<void> {
  void payload;
  throw new Error("Backend save is not implemented in this prototype.");
}

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

function downloadGeoJson(data: EditableFeatureCollection) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/geo+json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "edited-lines.geojson";
  anchor.click();
  URL.revokeObjectURL(url);
}

function normalizeFeatureIds(
  featureCollection: EditableFeatureCollection,
  nextId: MutableRefObject<number>,
): EditableFeatureCollection {
  let changed = false;
  const features = featureCollection.features.map((feature) => {
    const properties: GeoJsonProperties = { ...(feature.properties ?? {}) };
    let featureChanged = false;

    if (typeof properties.id !== "string" || properties.id.length === 0) {
      properties.id = `line-${Date.now()}-${nextId.current++}`;
      changed = true;
      featureChanged = true;
    }

    if (!featureChanged) {
      return feature;
    }

    const nextFeature: EditableFeature = {
      ...feature,
      properties,
    };

    return nextFeature;
  });

  if (!changed) {
    return featureCollection;
  }

  return {
    ...featureCollection,
    features,
  };
}

function coerceLineFeatures(featureCollection: AnyFeatureCollection): EditableFeatureCollection {
  const lineFeatures = featureCollection.features.filter((feature) => {
    return feature.geometry?.type === "LineString";
  }) as EditableFeature[];

  return {
    type: "FeatureCollection",
    features: lineFeatures,
  };
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const nextFeatureId = useRef(1);

  const [editableData, setEditableData] = useState<EditableFeatureCollection>(INITIAL_LINES);
  const [selectedFeatureIndexes, setSelectedFeatureIndexes] = useState<number[]>([]);
  const [mode, setMode] = useState<EditModeKey>("view");

  const cogLayer = useMemo(
    () =>
      new COGLayer({
        id: "raster-layer",
        geotiff: DEFAULT_COG_URL,
        onGeoTIFFLoad: (
          _tiff: unknown,
          options: {
            geographicBounds: { west: number; south: number; east: number; north: number };
          },
        ) => {
          const { west, south, east, north } = options.geographicBounds;
          mapRef.current?.fitBounds(
            [
              [west, south],
              [east, north],
            ],
            {
              padding: 40,
              duration: 1000,
            },
          );
        },
      }),
    [],
  );

  const editableLayer = useMemo(
    () =>
      new EditableGeoJsonLayer({
        id: "editable-lines",
        data: editableData,
        mode: EDIT_MODES[mode],
        selectedFeatureIndexes,
        pickable: true,
        onEdit: ({ updatedData }: { updatedData: AnyFeatureCollection }) => {
          const lineOnlyData = coerceLineFeatures(updatedData);
          const normalized = normalizeFeatureIds(lineOnlyData, nextFeatureId);
          setEditableData(normalized);
        },
        onClick: ({ index }: { index: number | null | undefined }) => {
          if (typeof index === "number" && index >= 0) {
            setSelectedFeatureIndexes([index]);
            return;
          }
          setSelectedFeatureIndexes([]);
        },
        getLineColor: [255, 50, 50, 255],
        getLineWidth: 3,
        lineWidthMinPixels: 2,
        pointRadiusMinPixels: 4,
      }),
    [editableData, mode, selectedFeatureIndexes],
  );

  const selectedFeatureLabel =
    selectedFeatureIndexes.length > 0 ? selectedFeatureIndexes[0] : "none";

  const handleDeleteSelected = () => {
    if (selectedFeatureIndexes.length === 0) {
      return;
    }

    const deleteIndex = selectedFeatureIndexes[0];
    const updatedFeatures = editableData.features.filter((_, index) => index !== deleteIndex);

    setEditableData({
      ...editableData,
      features: updatedFeatures,
    });
    setSelectedFeatureIndexes([]);
    setMode("view");
  };

  const handleSaveGeoJson = () => {
    downloadGeoJson(editableData);
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: -114.09,
          latitude: 51.051,
          zoom: 10,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
      >
        <DeckGLOverlay layers={[cogLayer, editableLayer]} interleaved />
      </MaplibreMap>

      <div
        style={{
          position: "absolute",
          top: "20px",
          left: "20px",
          zIndex: 1000,
          background: "rgba(255, 255, 255, 0.95)",
          border: "1px solid #d7dde3",
          borderRadius: "10px",
          boxShadow: "0 8px 22px rgba(0, 0, 0, 0.16)",
          padding: "12px",
          width: "360px",
        }}
      >
        <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "10px" }}>
          COG + Line Editor Prototype
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button type="button" onClick={() => setMode("view")}>
            View
          </button>
          <button type="button" onClick={() => setMode("modify")}>
            Edit
          </button>
          <button type="button" onClick={() => setMode("drawLine")}>
            Draw Line
          </button>
          <button
            type="button"
            onClick={handleDeleteSelected}
            disabled={selectedFeatureIndexes.length === 0}
          >
            Delete Selected
          </button>
          <button type="button" onClick={handleSaveGeoJson}>
            Save GeoJSON
          </button>
        </div>

        <div
          style={{
            marginTop: "10px",
            paddingTop: "10px",
            borderTop: "1px solid #e8edf2",
            fontSize: "13px",
            color: "#37414b",
            lineHeight: 1.45,
          }}
        >
          <div>Selected feature: {selectedFeatureLabel}</div>
          <div>Feature count: {editableData.features.length}</div>
          <div>Current mode: {mode}</div>
        </div>
      </div>
    </div>
  );
}
