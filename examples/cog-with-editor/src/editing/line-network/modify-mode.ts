import { ModifyMode } from "@deck.gl-community/editable-layers";
import type { Position } from "geojson";
import {
  getConnectedLineStringEndpoints,
  getLineStringEndpointRefs,
  moveLineStringEndpointGroup,
  toCoordinate2d,
} from "./endpoints.js";
import { findNearestLineStringEndpoint } from "./snapping.js";
import type {
  LineStringEndpointRef,
  LineStringFeatureCollection,
} from "./types.js";

export type LineStringNetworkModifyModeConfig = {
  snapTolerance?: number;
  moveConnectedEndpoints?: boolean;
};

type EditableEditContext = {
  featureIndexes?: number[];
  positionIndexes?: number[];
  position?: Position;
};

type SharedEndpointDrag = {
  featureIndex: number;
  coordinateIndex: number;
  endpoints: LineStringEndpointRef[];
};

const DEFAULT_SNAP_TOLERANCE_METERS = 5;

function getMovedEndpoint(
  featureCollection: LineStringFeatureCollection,
  editContext: EditableEditContext | undefined,
): LineStringEndpointRef | null {
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

export class LineStringNetworkModifyMode extends ModifyMode {
  private sharedEndpointDrag: SharedEndpointDrag | null = null;

  getSnapTolerance(props: { modeConfig?: LineStringNetworkModifyModeConfig }) {
    return props.modeConfig?.snapTolerance ?? DEFAULT_SNAP_TOLERANCE_METERS;
  }

  getMoveConnectedEndpoints(props: {
    modeConfig?: LineStringNetworkModifyModeConfig;
  }) {
    return props.modeConfig?.moveConnectedEndpoints ?? true;
  }

  applySharedEndpointMove(
    previousData: LineStringFeatureCollection,
    updatedData: LineStringFeatureCollection,
    editContext: EditableEditContext | undefined,
    props: { modeConfig?: LineStringNetworkModifyModeConfig },
  ) {
    if (!this.getMoveConnectedEndpoints(props)) {
      this.sharedEndpointDrag = null;
      return updatedData;
    }

    const toleranceMeters = this.getSnapTolerance(props);
    const movedEndpoint = getMovedEndpoint(updatedData, editContext);
    if (!movedEndpoint) {
      this.sharedEndpointDrag = null;
      return updatedData;
    }

    if (
      !this.sharedEndpointDrag ||
      this.sharedEndpointDrag.featureIndex !== movedEndpoint.featureIndex ||
      this.sharedEndpointDrag.coordinateIndex !== movedEndpoint.coordinateIndex
    ) {
      const previousMovedEndpoint = getMovedEndpoint(previousData, editContext);
      if (!previousMovedEndpoint) {
        return updatedData;
      }

      this.sharedEndpointDrag = {
        featureIndex: movedEndpoint.featureIndex,
        coordinateIndex: movedEndpoint.coordinateIndex,
        endpoints: getConnectedLineStringEndpoints(
          previousData,
          previousMovedEndpoint,
          { toleranceMeters },
        ).endpoints,
      };
    }

    const sharedEndpoints = this.sharedEndpointDrag.endpoints;
    const snapTarget = findNearestLineStringEndpoint(
      getLineStringEndpointRefs(updatedData),
      movedEndpoint.coordinate,
      { ignore: sharedEndpoints, toleranceMeters },
    );
    const finalCoordinate = snapTarget?.coordinate ?? movedEndpoint.coordinate;

    return moveLineStringEndpointGroup(
      updatedData,
      {
        representativeCoordinate:
          sharedEndpoints[0]?.coordinate ?? finalCoordinate,
        endpoints: sharedEndpoints,
      },
      finalCoordinate,
    );
  }

  _dragEditHandle(editType: string, props: any, editHandle: any, event: any) {
    const wrappedProps = {
      ...props,
      onEdit: (editAction: any) => {
        const isMove =
          editAction.editType === "movePosition" ||
          editAction.editType === "finishMovePosition";
        const updatedData = isMove
          ? this.applySharedEndpointMove(
              props.data,
              editAction.updatedData,
              editAction.editContext,
              props,
            )
          : editAction.updatedData;

        if (editAction.editType === "finishMovePosition") {
          this.sharedEndpointDrag = null;
        }

        props.onEdit({
          ...editAction,
          updatedData,
        });
      },
    };

    super._dragEditHandle(editType, wrappedProps, editHandle, event);
  }
}
