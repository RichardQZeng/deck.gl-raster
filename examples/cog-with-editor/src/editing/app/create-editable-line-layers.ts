import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import {
  EditableGeoJsonLayer,
  ModifyMode,
  ViewMode,
} from "@deck.gl-community/editable-layers";
import type { Feature } from "geojson";
import {
  DRAW_SNAP_TOLERANCE_METERS,
  EDIT_PICKING_RADIUS_PIXELS,
  SNAP_TOLERANCE_METERS,
} from "../../constants.js";
import {
  getConnectedLineStringEndpoints,
  getLineStringEndpointRefs,
  LineStringNetworkDrawMode,
  LineStringNetworkModifyMode,
  toCoordinate2d,
  type LineStringNetworkDrawModeConfig,
  type LineStringNetworkModifyModeConfig,
} from "@deck.gl-community/editable-layers/line-network";
import type {
  CaptureLine,
  EditableEditAction,
  EditableFeatureCollection,
  EditModeKey,
  EndpointMarker,
} from "../../types.js";

const EDIT_MODES: Record<
  EditModeKey,
  typeof ViewMode | typeof ModifyMode | typeof LineStringNetworkDrawMode
> = {
  view: ViewMode,
  modify: LineStringNetworkModifyMode,
  deleteVertex: ModifyMode,
  drawLine: LineStringNetworkDrawMode,
};

export function isEditableLayerPick(info: {
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

export function getFeatureId(feature: Feature | undefined) {
  const id = feature?.properties?.id;
  return typeof id === "string" ? id : null;
}

export function getEditHandleKey(info: { object?: any }) {
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

export function createEditableLineLayer({
  editableData,
  mode,
  selectedFeatureIndexes,
  selectedFeatureIds,
  hoveredFeatureId,
  hoveredEditHandleKey,
  onEdit,
  onClick,
  onCancelPan,
}: {
  editableData: EditableFeatureCollection;
  mode: EditModeKey;
  selectedFeatureIndexes: number[];
  selectedFeatureIds: Set<string>;
  hoveredFeatureId: string | null;
  hoveredEditHandleKey: string | null;
  onEdit: (editAction: EditableEditAction) => void;
  onClick: (info: {
    index: number | null | undefined;
    isGuide?: boolean;
    object?: any;
  }) => void;
  onCancelPan: () => void;
}) {
  return new EditableGeoJsonLayer({
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
    onEdit,
    onClick,
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
    onCancelPan,
  });
}

export function createCaptureLineLayer({
  editableData,
  mode,
  hoveredFeatureId,
  onHover,
  onClick,
}: {
  editableData: EditableFeatureCollection;
  mode: EditModeKey;
  hoveredFeatureId: string | null;
  onHover: (info: { object?: CaptureLine | null }) => void;
  onClick: (info: { object?: CaptureLine | null }) => void;
}) {
  return new PathLayer<CaptureLine>({
    id: "capture-lines",
    data: getCaptureLines(editableData),
    pickable: mode !== "drawLine",
    widthUnits: "pixels",
    getPath: (line) => line.path,
    getColor: (line) =>
      line.featureId === hoveredFeatureId ? [255, 180, 0, 40] : [0, 0, 0, 1],
    getWidth: (line) => (line.featureId === hoveredFeatureId ? 24 : 18),
    widthMinPixels: 18,
    onHover,
    onClick,
  });
}

export function createEndpointMarkerLayer(
  editableData: EditableFeatureCollection,
) {
  return new ScatterplotLayer<EndpointMarker>({
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
  });
}
