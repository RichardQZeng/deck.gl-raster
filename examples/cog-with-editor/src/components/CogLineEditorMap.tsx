import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import {
  EditableGeoJsonLayer,
  ModifyMode,
  ViewMode,
} from "@deck.gl-community/editable-layers";
import type { Feature, GeoJsonProperties } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ChangeEvent, MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import { EditorToolbar } from "./EditorToolbar.js";
import {
  DEFAULT_COG_URL,
  DRAW_SNAP_TOLERANCE_METERS,
  EDIT_PICKING_RADIUS_PIXELS,
  SNAP_TOLERANCE_METERS,
} from "../constants.js";
import { INITIAL_LINES } from "../data/initial-lines.js";
import {
  findNearestLineStringEndpoint,
  getConnectedLineStringEndpoints,
  getLineStringEndpointRefs,
  LineStringNetworkDrawMode,
  LineStringNetworkModifyMode,
  setLineStringEndpointCoordinate,
  toCoordinate2d,
  type LineStringNetworkDrawModeConfig,
  type LineStringNetworkModifyModeConfig,
} from "../editing/line-network/index.js";
import { downloadGeoJson } from "../io/geojson.js";
import { loadCenterlineTable } from "../io/geopackage.js";
import { DeckGLOverlay } from "../map/DeckGLOverlay.js";
import { createCogLayer } from "../raster/create-cog-layer.js";
import type {
  AnyFeatureCollection,
  CaptureLine,
  EditableEditAction,
  EditableEditContext,
  EditableFeature,
  EditableFeatureCollection,
  EditModeKey,
  EndpointMarker,
  SaveCenterlinesPayload,
} from "../types.js";

export async function saveToBackend(
  payload: SaveCenterlinesPayload,
): Promise<void> {
  void payload;
  throw new Error("Backend save is not implemented in this prototype.");
}

function isEditableLayerPick(info: {
  isGuide?: boolean;
  isEditingHandle?: boolean;
  object?: any;
}) {
  return (
    info.isGuide === true ||
    info.isEditingHandle === true ||
    info.object?.properties?.guideType === "editHandle"
  );
}

function getFeatureId(feature: Feature | undefined) {
  const id = feature?.properties?.id;
  return typeof id === "string" ? id : null;
}

function getEditHandleKey(info: { object?: any }) {
  const properties = info.object?.properties;
  if (properties?.guideType !== "editHandle") {
    return null;
  }

  return [properties.featureIndex, ...(properties.positionIndexes ?? [])].join(
    ":",
  );
}

function getEditHandleRadius(handle: any, hoveredEditHandleKey: string | null) {
  if (handle.properties?.editHandleType === "snap-target") {
    return 12;
  }

  if (getEditHandleKey({ object: handle }) === hoveredEditHandleKey) {
    return 14;
  }

  return handle.properties?.editHandleType === "existing" ? 4 : 3;
}

function getCaptureLines(
  featureCollection: EditableFeatureCollection,
): CaptureLine[] {
  return featureCollection.features.map((feature, featureIndex) => ({
    featureIndex,
    featureId: getFeatureId(feature),
    path: feature.geometry.coordinates.map(toCoordinate2d),
  }));
}

const EDIT_MODES: Record<
  EditModeKey,
  typeof ViewMode | typeof ModifyMode | typeof LineStringNetworkDrawMode
> = {
  view: ViewMode,
  modify: LineStringNetworkModifyMode,
  deleteVertex: ModifyMode,
  drawLine: LineStringNetworkDrawMode,
};

function getEndpointMarkers(
  featureCollection: EditableFeatureCollection,
): EndpointMarker[] {
  const markers: EndpointMarker[] = [];
  const handledEndpointKeys = new Set<string>();

  for (const endpoint of getLineStringEndpointRefs(featureCollection)) {
    const endpointKey = `${endpoint.featureIndex}:${endpoint.coordinateIndex}`;
    if (handledEndpointKeys.has(endpointKey)) {
      continue;
    }

    const group = getConnectedLineStringEndpoints(featureCollection, endpoint, {
      toleranceMeters: SNAP_TOLERANCE_METERS,
    });
    for (const groupEndpoint of group.endpoints) {
      handledEndpointKeys.add(
        `${groupEndpoint.featureIndex}:${groupEndpoint.coordinateIndex}`,
      );
    }

    markers.push({
      coordinate: endpoint.coordinate,
      count: group.endpoints.length,
    });
  }

  return markers;
}

function snapNewFeatureEndpoints(
  previousData: EditableFeatureCollection,
  updatedData: EditableFeatureCollection,
  editContext: EditableEditContext | undefined,
) {
  const featureIndexes = editContext?.featureIndexes;
  if (!featureIndexes?.length) {
    return updatedData;
  }

  let snappedData = updatedData;
  const existingEndpoints = getLineStringEndpointRefs(previousData);

  for (const featureIndex of featureIndexes) {
    const feature = snappedData.features[featureIndex];
    if (!feature || feature.geometry.coordinates.length === 0) {
      continue;
    }

    const lastIndex = feature.geometry.coordinates.length - 1;
    for (const coordinateIndex of [0, lastIndex]) {
      const coordinate = feature.geometry.coordinates[coordinateIndex];
      const snapTarget = findNearestLineStringEndpoint(
        existingEndpoints,
        toCoordinate2d(coordinate),
        { ignore: [], toleranceMeters: SNAP_TOLERANCE_METERS },
      );
      if (snapTarget) {
        snappedData = setLineStringEndpointCoordinate(
          snappedData,
          {
            featureIndex,
            coordinateIndex,
            coordinate: toCoordinate2d(coordinate),
          },
          snapTarget.coordinate,
        );
      }
    }
  }

  return snappedData;
}

function getFeatureCollectionBounds(
  featureCollection: EditableFeatureCollection,
) {
  let minLongitude = Number.POSITIVE_INFINITY;
  let minLatitude = Number.POSITIVE_INFINITY;
  let maxLongitude = Number.NEGATIVE_INFINITY;
  let maxLatitude = Number.NEGATIVE_INFINITY;

  for (const feature of featureCollection.features) {
    for (const [longitude, latitude] of feature.geometry.coordinates) {
      minLongitude = Math.min(minLongitude, longitude);
      minLatitude = Math.min(minLatitude, latitude);
      maxLongitude = Math.max(maxLongitude, longitude);
      maxLatitude = Math.max(maxLatitude, latitude);
    }
  }

  if (!Number.isFinite(minLongitude)) {
    return null;
  }

  return [
    [minLongitude, minLatitude],
    [maxLongitude, maxLatitude],
  ] as [[number, number], [number, number]];
}

function fitMapToFeatureCollection(
  mapRef: MutableRefObject<MapRef | null>,
  data: EditableFeatureCollection,
) {
  const bounds = getFeatureCollectionBounds(data);
  if (!bounds) {
    return;
  }

  requestAnimationFrame(() => {
    mapRef.current?.fitBounds(bounds, {
      padding: 40,
      duration: 800,
    });
  });
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

function coerceLineFeatures(
  featureCollection: AnyFeatureCollection,
): EditableFeatureCollection {
  const lineFeatures = featureCollection.features.filter((feature) => {
    return feature.geometry?.type === "LineString";
  }) as EditableFeature[];

  return {
    type: "FeatureCollection",
    features: lineFeatures,
  };
}

export function CogLineEditorMap() {
  const mapRef = useRef<MapRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasLoadedGeoPackage = useRef(false);
  const nextFeatureId = useRef(1);
  const disabledMapDragPan = useRef(false);

  const [editableData, setEditableData] =
    useState<EditableFeatureCollection>(INITIAL_LINES);
  const [selectedFeatureIndexes, setSelectedFeatureIndexes] = useState<
    number[]
  >([]);
  const [hoveredFeatureId, setHoveredFeatureId] = useState<string | null>(null);
  const [hoveredCaptureFeatureId, setHoveredCaptureFeatureId] = useState<
    string | null
  >(null);
  const [hoveredEditHandleKey, setHoveredEditHandleKey] = useState<
    string | null
  >(null);
  const [importStatus, setImportStatus] = useState("No GPKG loaded");
  const [mode, setMode] = useState<EditModeKey>("view");

  const setMapCursor = useCallback((cursor: string) => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) {
      canvas.style.cursor = cursor;
    }
  }, []);

  const disableMapDragPan = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || disabledMapDragPan.current || !map.dragPan.isEnabled()) {
      return;
    }

    map.dragPan.disable();
    disabledMapDragPan.current = true;
  }, []);

  const restoreMapDragPan = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !disabledMapDragPan.current) {
      return;
    }

    map.dragPan.enable();
    disabledMapDragPan.current = false;
  }, []);

  useEffect(() => {
    if (mode) {
      setMapCursor("");
    }
  }, [mode, setMapCursor]);

  useEffect(() => {
    if (mode === "modify" || mode === "deleteVertex") {
      return;
    }

    restoreMapDragPan();
    setMapCursor("");
  }, [mode, restoreMapDragPan, setMapCursor]);

  useEffect(() => {
    return () => {
      restoreMapDragPan();
    };
  }, [restoreMapDragPan]);

  const handleOverlayHover = useCallback(
    (info: { index?: number; object?: any; isGuide?: boolean }) => {
      const editHandleKey = getEditHandleKey(info);
      setHoveredEditHandleKey(editHandleKey);

      if (editHandleKey) {
        const featureIndex = info.object?.properties?.featureIndex;
        setHoveredFeatureId(
          typeof featureIndex === "number"
            ? getFeatureId(editableData.features[featureIndex])
            : null,
        );
        return;
      }

      if (info.object?.geometry?.type === "LineString") {
        setHoveredFeatureId(getFeatureId(info.object));
        return;
      }

      if (hoveredCaptureFeatureId) {
        setHoveredFeatureId(hoveredCaptureFeatureId);
        return;
      }

      setHoveredFeatureId(null);
    },
    [editableData.features, hoveredCaptureFeatureId],
  );

  const handleCaptureLineHover = useCallback(
    (info: { object?: CaptureLine | null }) => {
      if (mode === "drawLine") {
        return;
      }

      const featureId = info.object?.featureId ?? null;
      setHoveredCaptureFeatureId(featureId);

      if (featureId) {
        setHoveredFeatureId(featureId);
        return;
      }

      if (!hoveredEditHandleKey) {
        setHoveredFeatureId(null);
      }
    },
    [hoveredEditHandleKey, mode],
  );

  const handleCaptureLineClick = useCallback(
    (info: { object?: CaptureLine | null }) => {
      if (mode === "drawLine") {
        return;
      }

      const featureIndex = info.object?.featureIndex;
      if (typeof featureIndex === "number") {
        setSelectedFeatureIndexes([featureIndex]);
        return;
      }

      setSelectedFeatureIndexes([]);
    },
    [mode],
  );

  const handleEditableLayerCancelPan = useCallback(() => {
    disableMapDragPan();
    setMapCursor("grabbing");
  }, [disableMapDragPan, setMapCursor]);

  const selectedFeatureIds = useMemo(() => {
    return new Set(
      selectedFeatureIndexes
        .map((featureIndex) => getFeatureId(editableData.features[featureIndex]))
        .filter((featureId): featureId is string => featureId !== null),
    );
  }, [editableData.features, selectedFeatureIndexes]);

  const cogLayer = useMemo(
    () =>
      createCogLayer({
        geotiff: DEFAULT_COG_URL,
        onGeographicBoundsLoad: ({ west, south, east, north }) => {
          if (hasLoadedGeoPackage.current) {
            return;
          }

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
        modeConfig:
          mode === "drawLine"
            ? ({
                snapTargets: getLineStringEndpointRefs(editableData),
                snapTolerance: DRAW_SNAP_TOLERANCE_METERS,
              } satisfies LineStringNetworkDrawModeConfig)
            : mode === "modify"
            ? ({
                snapTolerance: SNAP_TOLERANCE_METERS,
                moveConnectedEndpoints: true,
              } satisfies LineStringNetworkModifyModeConfig)
            : undefined,
        selectedFeatureIndexes,
        pickable: true,
        pickingRadius: EDIT_PICKING_RADIUS_PIXELS,
        pickingDepth: 10,
        onEdit: ({
          updatedData,
          editType,
          editContext,
        }: EditableEditAction) => {
          if (mode === "deleteVertex") {
            if (editType !== "removePosition") {
              return;
            }
          } else if (editType === "removePosition") {
            return;
          }

          const lineOnlyData = coerceLineFeatures(updatedData);
          let normalized = normalizeFeatureIds(lineOnlyData, nextFeatureId);

          if (editType === "addFeature") {
            normalized = snapNewFeatureEndpoints(
              editableData,
              normalized,
              editContext,
            );
          }

          if (editType === "finishMovePosition") {
            restoreMapDragPan();
            setMapCursor("");
          }

          setEditableData(normalized);
        },
        onClick: (info: {
          index: number | null | undefined;
          isGuide?: boolean;
          object?: any;
        }) => {
          if (isEditableLayerPick(info)) {
            return;
          }

          if (mode === "drawLine") {
            return;
          }

          const { index } = info;
          if (typeof index === "number" && index >= 0) {
            setSelectedFeatureIndexes([index]);
            return;
          }
          setSelectedFeatureIndexes([]);
        },
        getLineColor: (feature: Feature) => {
          const featureId = getFeatureId(feature);
          const isSelected = featureId ? selectedFeatureIds.has(featureId) : false;
          const isHovered = featureId === hoveredFeatureId;

          if (isSelected && isHovered) {
            return [0, 235, 255, 255];
          }

          if (isSelected) {
            return [0, 200, 235, 255];
          }

          if (isHovered) {
            return [255, 140, 0, 255];
          }

          return [255, 50, 50, 255];
        },
        getLineWidth: (feature: Feature) => {
          const featureId = getFeatureId(feature);
          const isSelected = featureId ? selectedFeatureIds.has(featureId) : false;
          const isHovered = featureId === hoveredFeatureId;

          if (isSelected && isHovered) {
            return 5;
          }

          if (isHovered) {
            return 5;
          }

          return 3;
        },
        lineWidthMinPixels: 2,
        pointRadiusMinPixels: 4,
        editHandlePointRadiusMinPixels: 4,
        editHandlePointRadiusMaxPixels: 18,
        getEditHandlePointRadius: (handle: any) =>
          getEditHandleRadius(handle, hoveredEditHandleKey),
        getEditHandlePointColor: (handle: any) =>
          handle.properties?.editHandleType === "snap-target"
            ? [0, 210, 255, 255]
            : getEditHandleKey({ object: handle }) === hoveredEditHandleKey
            ? [255, 170, 0, 255]
            : [192, 0, 0, 255],
        getEditHandlePointOutlineColor: (handle: any) =>
          handle.properties?.editHandleType === "snap-target"
            ? [0, 40, 70, 255]
            : getEditHandleKey({ object: handle }) === hoveredEditHandleKey
            ? [20, 20, 20, 255]
            : [255, 255, 255, 255],
        onCancelPan: handleEditableLayerCancelPan,
      }),
    [
      editableData,
      handleEditableLayerCancelPan,
      hoveredEditHandleKey,
      hoveredFeatureId,
      mode,
      restoreMapDragPan,
      selectedFeatureIds,
      selectedFeatureIndexes,
    ],
  );

  const captureLineLayer = useMemo(
    () =>
      new PathLayer<CaptureLine>({
        id: "capture-lines",
        data: getCaptureLines(editableData),
        pickable: mode !== "drawLine",
        widthUnits: "pixels",
        getPath: (line) => line.path,
        getColor: (line) =>
          line.featureId === hoveredFeatureId ? [255, 180, 0, 40] : [0, 0, 0, 1],
        getWidth: (line) => (line.featureId === hoveredFeatureId ? 24 : 18),
        widthMinPixels: 18,
        onHover: handleCaptureLineHover,
        onClick: handleCaptureLineClick,
      }),
    [
      editableData,
      handleCaptureLineClick,
      handleCaptureLineHover,
      hoveredFeatureId,
      mode,
    ],
  );

  const endpointMarkerLayer = useMemo(
    () =>
      new ScatterplotLayer<EndpointMarker>({
        id: "endpoint-markers",
        data: getEndpointMarkers(editableData),
        pickable: false,
        radiusUnits: "pixels",
        stroked: true,
        filled: true,
        lineWidthUnits: "pixels",
        getPosition: (marker) => marker.coordinate,
        getRadius: (marker) => (marker.count > 1 ? 8 : 4),
        getFillColor: (marker) =>
          marker.count > 1 ? [0, 210, 255, 220] : [255, 255, 255, 170],
        getLineColor: (marker) =>
          marker.count > 1 ? [0, 40, 70, 255] : [255, 190, 0, 220],
        getLineWidth: (marker) => (marker.count > 1 ? 2 : 1),
      }),
    [editableData],
  );

  const selectedFeatureLabel =
    selectedFeatureIndexes.length > 0 ? selectedFeatureIndexes[0] : "none";

  const handleDeleteSelected = () => {
    if (selectedFeatureIndexes.length === 0) {
      return;
    }

    const deleteIndex = selectedFeatureIndexes[0];
    const updatedFeatures = editableData.features.filter(
      (_, index) => index !== deleteIndex,
    );

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

  const handleLoadGeoPackage = () => {
    fileInputRef.current?.click();
  };

  const handleGeoPackageFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setImportStatus("Loading centerline...");
    try {
      const { data, strippedZ } = await loadCenterlineTable(file);
      hasLoadedGeoPackage.current = true;
      setEditableData(data);
      setSelectedFeatureIndexes(data.features.length > 0 ? [0] : []);
      setMode("modify");
      setImportStatus(
        `Loaded centerline: ${data.features.length} features${strippedZ ? "; stripped Z coordinates" : ""}`,
      );

      fitMapToFeatureCollection(mapRef, data);
    } catch (error) {
      setImportStatus(
        error instanceof Error ? error.message : "Failed to load centerline",
      );
    }
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
        doubleClickZoom={false}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
      >
        <DeckGLOverlay
          layers={[cogLayer, captureLineLayer, editableLayer, endpointMarkerLayer]}
          interleaved
          onHover={handleOverlayHover}
        />
      </MaplibreMap>

      <input
        ref={fileInputRef}
        type="file"
        accept=".gpkg,application/geopackage+sqlite3,application/octet-stream"
        onChange={handleGeoPackageFileChange}
        style={{ display: "none" }}
      />

      <EditorToolbar
        mode={mode}
        selectedFeatureLabel={selectedFeatureLabel}
        featureCount={editableData.features.length}
        importStatus={importStatus}
        canDeleteSelected={selectedFeatureIndexes.length > 0}
        onModeChange={setMode}
        onLoadGeoPackage={handleLoadGeoPackage}
        onDeleteSelected={handleDeleteSelected}
        onSaveGeoJson={handleSaveGeoJson}
      />
    </div>
  );
}
