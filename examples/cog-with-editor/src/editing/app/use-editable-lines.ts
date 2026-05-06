import type { GeoJsonProperties } from "geojson";
import type { ChangeEvent, MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { SNAP_TOLERANCE_METERS } from "../../constants.js";
import { INITIAL_LINES } from "../../data/initial-lines.js";
import { downloadGeoJson } from "../../io/geojson.js";
import { loadCenterlineTable } from "../../io/geopackage.js";
import {
  findNearestLineStringEndpoint,
  getLineStringEndpointRefs,
  setLineStringEndpointCoordinate,
  toCoordinate2d,
} from "@deck.gl-community/editable-layers/line-network";
import {
  createCaptureLineLayer,
  createEditableLineLayer,
  createEndpointMarkerLayer,
  getEditHandleKey,
  getFeatureId,
  isEditableLayerPick,
} from "./create-editable-line-layers.js";
import type {
  AnyFeatureCollection,
  CaptureLine,
  EditableEditAction,
  EditableEditContext,
  EditableFeature,
  EditableFeatureCollection,
  EditModeKey,
} from "../../types.js";

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

export function useEditableLines({
  mapRef,
  fileInputRef,
}: {
  mapRef: MutableRefObject<MapRef | null>;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
}) {
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

  const setMapCursor = useCallback(
    (cursor: string) => {
      const canvas = mapRef.current?.getCanvas();
      if (canvas) {
        canvas.style.cursor = cursor;
      }
    },
    [mapRef],
  );

  const disableMapDragPan = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || disabledMapDragPan.current || !map.dragPan.isEnabled()) {
      return;
    }

    map.dragPan.disable();
    disabledMapDragPan.current = true;
  }, [mapRef]);

  const restoreMapDragPan = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !disabledMapDragPan.current) {
      return;
    }

    map.dragPan.enable();
    disabledMapDragPan.current = false;
  }, [mapRef]);

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

  const editableLayer = useMemo(
    () =>
      createEditableLineLayer({
        editableData,
        mode,
        selectedFeatureIndexes,
        selectedFeatureIds,
        hoveredFeatureId,
        hoveredEditHandleKey,
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
      setMapCursor,
    ],
  );

  const captureLineLayer = useMemo(
    () =>
      createCaptureLineLayer({
        editableData,
        mode,
        hoveredFeatureId,
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
    () => createEndpointMarkerLayer(editableData),
    [editableData],
  );

  const selectedFeatureLabel: number | "none" =
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

  const handleCogGeographicBoundsLoad = useCallback(
    ({
      west,
      south,
      east,
      north,
    }: {
      west: number;
      south: number;
      east: number;
      north: number;
    }) => {
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
    [mapRef],
  );

  return {
    editableData,
    mode,
    setMode,
    selectedFeatureIndexes,
    selectedFeatureLabel,
    importStatus,
    editableLayer,
    captureLineLayer,
    endpointMarkerLayer,
    handleOverlayHover,
    handleDeleteSelected,
    handleSaveGeoJson,
    handleLoadGeoPackage,
    handleGeoPackageFileChange,
    handleCogGeographicBoundsLoad,
  };
}
