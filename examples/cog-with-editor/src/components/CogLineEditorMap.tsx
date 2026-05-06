import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import {
  DrawLineStringMode,
  EditableGeoJsonLayer,
  type ClickEvent,
  type GuideFeatureCollection,
  type ModeProps,
  type PointerMoveEvent,
  ModifyMode,
  ViewMode,
} from "@deck.gl-community/editable-layers";
import sqlWasmUrl from "@ngageoint/geopackage/dist/sql-wasm.wasm?url";
import type {
  Feature,
  GeoJsonProperties,
  Position,
} from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import proj4 from "proj4";
import type { ChangeEvent, MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import { EditorToolbar } from "./EditorToolbar.js";
import {
  CENTERLINE_TABLE_NAME,
  DEFAULT_COG_URL,
  DRAW_SNAP_TOLERANCE_METERS,
  EDIT_PICKING_RADIUS_PIXELS,
  SNAP_TOLERANCE_METERS,
  TEST_GPKG_SRS,
  WGS84,
} from "../constants.js";
import { INITIAL_LINES } from "../data/initial-lines.js";
import { DeckGLOverlay } from "../map/DeckGLOverlay.js";
import { createCogLayer } from "../raster/create-cog-layer.js";
import type {
  AnyFeatureCollection,
  CaptureLine,
  Coordinate2d,
  EditableEditAction,
  EditableEditContext,
  EditableFeature,
  EditableFeatureCollection,
  EditModeKey,
  EndpointMarker,
  EndpointRef,
  EndpointSnapDrawModeConfig,
  LoadedCenterlines,
  SaveCenterlinesPayload,
  SharedEndpointDrag,
} from "../types.js";

proj4.defs(
  "EPSG:2956",
  "+proj=utm +zone=12 +ellps=GRS80 +datum=NAD83 +units=m +no_defs +type=crs",
);

export async function saveToBackend(
  payload: SaveCenterlinesPayload,
): Promise<void> {
  void payload;
  throw new Error("Backend save is not implemented in this prototype.");
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

function toCoordinate2d(position: Position): Coordinate2d {
  return [position[0], position[1]];
}

function distanceMeters(a: Coordinate2d, b: Coordinate2d) {
  const metersPerDegreeLatitude = 111_320;
  const averageLatitudeRadians = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const metersPerDegreeLongitude =
    metersPerDegreeLatitude * Math.cos(averageLatitudeRadians);
  const dx = (a[0] - b[0]) * metersPerDegreeLongitude;
  const dy = (a[1] - b[1]) * metersPerDegreeLatitude;
  return Math.sqrt(dx * dx + dy * dy);
}

function coordinatesWithinTolerance(a: Coordinate2d, b: Coordinate2d) {
  return distanceMeters(a, b) <= SNAP_TOLERANCE_METERS;
}

function getEndpointRefs(
  featureCollection: EditableFeatureCollection,
): EndpointRef[] {
  const endpoints: EndpointRef[] = [];

  featureCollection.features.forEach((feature, featureIndex) => {
    const { coordinates } = feature.geometry;
    if (coordinates.length === 0) {
      return;
    }

    endpoints.push({
      featureIndex,
      coordinateIndex: 0,
      coordinate: toCoordinate2d(coordinates[0]),
    });

    if (coordinates.length > 1) {
      const coordinateIndex = coordinates.length - 1;
      endpoints.push({
        featureIndex,
        coordinateIndex,
        coordinate: toCoordinate2d(coordinates[coordinateIndex]),
      });
    }
  });

  return endpoints;
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

function isSameEndpoint(a: EndpointRef, b: EndpointRef) {
  return (
    a.featureIndex === b.featureIndex && a.coordinateIndex === b.coordinateIndex
  );
}

function findNearestEndpoint(
  endpoints: EndpointRef[],
  coordinate: Coordinate2d,
  ignoredEndpoints: EndpointRef[],
  toleranceMeters = SNAP_TOLERANCE_METERS,
) {
  let nearest: EndpointRef | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const endpoint of endpoints) {
    if (ignoredEndpoints.some((ignored) => isSameEndpoint(ignored, endpoint))) {
      continue;
    }

    const distance = distanceMeters(endpoint.coordinate, coordinate);
    if (distance <= toleranceMeters && distance < nearestDistance) {
      nearest = endpoint;
      nearestDistance = distance;
    }
  }

  return nearest;
}

class EndpointSnapDrawLineStringMode extends DrawLineStringMode {
  getNonSnapTargetPicks(event: ClickEvent | PointerMoveEvent) {
    return event.picks.filter(
      (pick) => pick.object?.properties?.editHandleType !== "snap-target",
    );
  }

  getSnapTarget(
    coordinate: Position,
    props: ModeProps<AnyFeatureCollection>,
  ) {
    const modeConfig = props.modeConfig as EndpointSnapDrawModeConfig | undefined;
    return findNearestEndpoint(
      modeConfig?.snapTargets ?? [],
      toCoordinate2d(coordinate),
      [],
      DRAW_SNAP_TOLERANCE_METERS,
    );
  }

  getSnapAwareEvent<T extends ClickEvent | PointerMoveEvent>(
    event: T,
    props: ModeProps<AnyFeatureCollection>,
  ): { event: T; snapTarget: EndpointRef | null } {
    const snapTarget = this.getSnapTarget(event.mapCoords, props);
    if (!snapTarget) {
      return { event, snapTarget: null };
    }

    return {
      event: {
        ...event,
        mapCoords: snapTarget.coordinate,
        picks: this.getNonSnapTargetPicks(event),
      },
      snapTarget,
    };
  }

  handleClick(event: ClickEvent, props: any) {
    const clickSequence = this.getClickSequence();
    const { event: snapAwareEvent, snapTarget } = this.getSnapAwareEvent(
      event,
      props,
    );

    if (snapTarget && clickSequence.length > 0) {
      const firstCoordinate = toCoordinate2d(clickSequence[0]);
      if (
        clickSequence.length > 1 ||
        !coordinatesWithinTolerance(firstCoordinate, snapTarget.coordinate)
      ) {
        this.addClickSequence(snapAwareEvent);
        this.finishDrawing(props);
        return;
      }
    }

    super.handleClick(snapAwareEvent, props);
  }

  handlePointerMove(
    event: PointerMoveEvent,
    props: any,
  ) {
    const { event: snapAwareEvent } = this.getSnapAwareEvent(event, props);
    super.handlePointerMove(snapAwareEvent, props);
  }

  getGuides(props: any): GuideFeatureCollection {
    const lastPointerMoveEvent = props.lastPointerMoveEvent;
    const snapTarget = lastPointerMoveEvent
      ? this.getSnapTarget(lastPointerMoveEvent.mapCoords, props)
      : null;

    const guides = super.getGuides({
      ...props,
      lastPointerMoveEvent:
        lastPointerMoveEvent && snapTarget
          ? {
              ...lastPointerMoveEvent,
              mapCoords: snapTarget.coordinate,
            }
          : lastPointerMoveEvent,
    });

    if (snapTarget) {
      guides.features.push({
        type: "Feature",
        properties: {
          guideType: "editHandle",
          editHandleType: "snap-target",
          featureIndex: snapTarget.featureIndex,
          positionIndexes: [snapTarget.coordinateIndex],
        },
        geometry: {
          type: "Point",
          coordinates: snapTarget.coordinate,
        },
      });
    }

    return guides;
  }
}

const EDIT_MODES: Record<
  EditModeKey,
  typeof ViewMode | typeof ModifyMode | typeof DrawLineStringMode
> = {
  view: ViewMode,
  modify: ModifyMode,
  deleteVertex: ModifyMode,
  drawLine: EndpointSnapDrawLineStringMode,
};

function getEndpointMarkers(
  featureCollection: EditableFeatureCollection,
): EndpointMarker[] {
  const markers: EndpointMarker[] = [];

  for (const endpoint of getEndpointRefs(featureCollection)) {
    const marker = markers.find((candidate) =>
      coordinatesWithinTolerance(candidate.coordinate, endpoint.coordinate),
    );

    if (marker) {
      marker.count += 1;
      continue;
    }

    markers.push({
      coordinate: endpoint.coordinate,
      count: 1,
    });
  }

  return markers;
}

function getMovedEndpoint(
  featureCollection: EditableFeatureCollection,
  editContext: EditableEditContext | undefined,
): EndpointRef | null {
  const featureIndex = editContext?.featureIndexes?.[0];
  const coordinateIndex = editContext?.positionIndexes?.[0];

  if (typeof featureIndex !== "number" || typeof coordinateIndex !== "number") {
    return null;
  }

  const feature = featureCollection.features[featureIndex];
  if (!feature) {
    return null;
  }

  const { coordinates } = feature.geometry;
  if (coordinateIndex !== 0 && coordinateIndex !== coordinates.length - 1) {
    return null;
  }

  const coordinate = coordinates[coordinateIndex];
  if (!coordinate) {
    return null;
  }

  return {
    featureIndex,
    coordinateIndex,
    coordinate: toCoordinate2d(coordinate),
  };
}

function applyEndpointCoordinate(
  featureCollection: EditableFeatureCollection,
  endpoints: EndpointRef[],
  coordinate: Coordinate2d,
): EditableFeatureCollection {
  if (endpoints.length === 0) {
    return featureCollection;
  }

  const endpointsByFeature = new Map<number, EndpointRef[]>();
  for (const endpoint of endpoints) {
    const featureEndpoints =
      endpointsByFeature.get(endpoint.featureIndex) ?? [];
    featureEndpoints.push(endpoint);
    endpointsByFeature.set(endpoint.featureIndex, featureEndpoints);
  }

  return {
    ...featureCollection,
    features: featureCollection.features.map((feature, featureIndex) => {
      const featureEndpoints = endpointsByFeature.get(featureIndex);
      if (!featureEndpoints) {
        return feature;
      }

      const coordinates = feature.geometry.coordinates.map((position) => [
        ...position,
      ]);
      for (const endpoint of featureEndpoints) {
        if (coordinates[endpoint.coordinateIndex]) {
          coordinates[endpoint.coordinateIndex] = coordinate;
        }
      }

      return {
        ...feature,
        geometry: {
          ...feature.geometry,
          coordinates,
        },
      };
    }),
  };
}

function applySharedEndpointMove(
  previousData: EditableFeatureCollection,
  updatedData: EditableFeatureCollection,
  editContext: EditableEditContext | undefined,
  dragRef: MutableRefObject<SharedEndpointDrag | null>,
) {
  const movedEndpoint = getMovedEndpoint(updatedData, editContext);
  if (!movedEndpoint) {
    dragRef.current = null;
    return updatedData;
  }

  if (
    !dragRef.current ||
    dragRef.current.featureIndex !== movedEndpoint.featureIndex ||
    dragRef.current.coordinateIndex !== movedEndpoint.coordinateIndex
  ) {
    const previousMovedEndpoint = getMovedEndpoint(previousData, editContext);
    if (!previousMovedEndpoint) {
      return updatedData;
    }

    dragRef.current = {
      featureIndex: movedEndpoint.featureIndex,
      coordinateIndex: movedEndpoint.coordinateIndex,
      endpoints: getEndpointRefs(previousData).filter((endpoint) =>
        coordinatesWithinTolerance(
          endpoint.coordinate,
          previousMovedEndpoint.coordinate,
        ),
      ),
    };
  }

  const sharedEndpoints = dragRef.current.endpoints;
  const snapTarget = findNearestEndpoint(
    getEndpointRefs(updatedData),
    movedEndpoint.coordinate,
    sharedEndpoints,
  );
  const finalCoordinate = snapTarget?.coordinate ?? movedEndpoint.coordinate;

  return applyEndpointCoordinate(updatedData, sharedEndpoints, finalCoordinate);
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
  const existingEndpoints = getEndpointRefs(previousData);

  for (const featureIndex of featureIndexes) {
    const feature = snappedData.features[featureIndex];
    if (!feature || feature.geometry.coordinates.length === 0) {
      continue;
    }

    const lastIndex = feature.geometry.coordinates.length - 1;
    for (const coordinateIndex of [0, lastIndex]) {
      const coordinate = feature.geometry.coordinates[coordinateIndex];
      const snapTarget = findNearestEndpoint(
        existingEndpoints,
        toCoordinate2d(coordinate),
        [],
      );
      if (snapTarget) {
        snappedData = applyEndpointCoordinate(
          snappedData,
          [
            {
              featureIndex,
              coordinateIndex,
              coordinate: toCoordinate2d(coordinate),
            },
          ],
          snapTarget.coordinate,
        );
      }
    }
  }

  return snappedData;
}

function transformCoordinate(position: Position, srsId: number) {
  if (srsId === 4326) {
    return toCoordinate2d(position);
  }

  const [longitude, latitude] = proj4(TEST_GPKG_SRS, WGS84, [
    position[0],
    position[1],
  ]);
  return [longitude, latitude] as Coordinate2d;
}

function transformLineString(coordinates: Position[], srsId: number) {
  let strippedZ = false;
  const transformedCoordinates = coordinates.map((coordinate) => {
    if (coordinate.length > 2) {
      strippedZ = true;
    }
    return transformCoordinate(coordinate, srsId);
  });

  return { coordinates: transformedCoordinates, strippedZ };
}

function getLineStringsFromGeoJson(geoJson: any): Position[][] {
  if (!geoJson) {
    return [];
  }

  if (geoJson.type === "Feature") {
    return getLineStringsFromGeoJson(geoJson.geometry);
  }

  if (geoJson.type === "LineString") {
    return [geoJson.coordinates];
  }

  if (geoJson.type === "MultiLineString") {
    return geoJson.coordinates;
  }

  return [];
}

function getFeatureProperties(
  feature: any,
  fallbackId: string,
  rowProperties: GeoJsonProperties = {},
): GeoJsonProperties {
  const featureProperties =
    feature.type === "Feature" ? feature.properties : undefined;
  const properties: NonNullable<GeoJsonProperties> = {
    ...rowProperties,
    ...(featureProperties ?? {}),
  };
  properties.id =
    typeof properties.id === "string" ? properties.id : fallbackId;
  return properties;
}

function getRowProperties(featureRow: {
  columnNames: string[];
  geometryColumn: { name: string };
  getValueWithColumnName: (columnName: string) => unknown;
}) {
  const properties: GeoJsonProperties = {};

  for (const columnName of featureRow.columnNames) {
    if (columnName === featureRow.geometryColumn.name) {
      continue;
    }

    const value = featureRow.getValueWithColumnName(columnName);
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      properties[columnName] = value;
    }
  }

  return properties;
}

async function loadCenterlineTable(file: File): Promise<LoadedCenterlines> {
  const { GeoPackageAPI, setSqljsWasmLocateFile } = await import(
    "@ngageoint/geopackage"
  );
  setSqljsWasmLocateFile(() => sqlWasmUrl);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const geoPackage = await GeoPackageAPI.open(bytes);

  try {
    if (!geoPackage.hasFeatureTable(CENTERLINE_TABLE_NAME)) {
      throw new Error("GPKG is missing centerline table");
    }

    const featureDao = geoPackage.getFeatureDao(CENTERLINE_TABLE_NAME);
    const srsId = featureDao.srs.srs_id;

    if (srsId !== 4326 && srsId !== 2956) {
      throw new Error(`Unsupported CRS: EPSG:${srsId}`);
    }

    const features: EditableFeature[] = [];
    let strippedZ = false;

    for (const rowValues of featureDao.queryForAll()) {
      const featureRow = featureDao.createObject(rowValues);
      const rawFeature = featureRow.geometry.toGeoJSON();
      const rowProperties = getRowProperties(featureRow);
      const lineStrings = getLineStringsFromGeoJson(rawFeature);

      lineStrings.forEach((coordinates, lineStringIndex) => {
        const transformed = transformLineString(coordinates, srsId);
        strippedZ = strippedZ || transformed.strippedZ;

        features.push({
          type: "Feature",
          properties: getFeatureProperties(
            rawFeature,
            `gpkg-${featureRow.id}${lineStrings.length > 1 ? `-${lineStringIndex}` : ""}`,
            rowProperties,
          ),
          geometry: {
            type: "LineString",
            coordinates: transformed.coordinates,
          },
        });
      });
    }

    if (features.length === 0) {
      throw new Error("No LineString features found in centerline");
    }

    return {
      data: {
        type: "FeatureCollection",
        features,
      },
      strippedZ,
    };
  } finally {
    geoPackage.close();
  }
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
  const sharedEndpointDrag = useRef<SharedEndpointDrag | null>(null);
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
                snapTargets: getEndpointRefs(editableData),
              } satisfies EndpointSnapDrawModeConfig)
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

          if (
            editType === "movePosition" ||
            editType === "finishMovePosition"
          ) {
            normalized = applySharedEndpointMove(
              editableData,
              normalized,
              editContext,
              sharedEndpointDrag,
            );
          } else {
            sharedEndpointDrag.current = null;
          }

          if (editType === "addFeature") {
            normalized = snapNewFeatureEndpoints(
              editableData,
              normalized,
              editContext,
            );
          }

          if (editType === "finishMovePosition") {
            sharedEndpointDrag.current = null;
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
