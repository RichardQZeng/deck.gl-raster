import {
  DrawLineStringMode,
  type ClickEvent,
  type GuideFeatureCollection,
  type ModeProps,
  type PointerMoveEvent,
} from "@deck.gl-community/editable-layers";
import type { FeatureCollection, Position } from "geojson";
import { toCoordinate2d } from "./endpoints.js";
import { findNearestLineStringEndpoint } from "./snapping.js";
import type { LineStringEndpointRef } from "./types.js";

export type LineStringNetworkDrawModeConfig = {
  snapTargets?: LineStringEndpointRef[];
  snapTolerance?: number;
};

const DEFAULT_SNAP_TOLERANCE_METERS = 5;

export class LineStringNetworkDrawMode extends DrawLineStringMode {
  getNonSnapTargetPicks(event: ClickEvent | PointerMoveEvent) {
    return event.picks.filter(
      (pick) => pick.object?.properties?.editHandleType !== "snap-target",
    );
  }

  getSnapTolerance(props: ModeProps<FeatureCollection>) {
    const modeConfig = props.modeConfig as
      | LineStringNetworkDrawModeConfig
      | undefined;
    return modeConfig?.snapTolerance ?? DEFAULT_SNAP_TOLERANCE_METERS;
  }

  getSnapTarget(coordinate: Position, props: ModeProps<FeatureCollection>) {
    const modeConfig = props.modeConfig as
      | LineStringNetworkDrawModeConfig
      | undefined;
    return findNearestLineStringEndpoint(
      modeConfig?.snapTargets ?? [],
      toCoordinate2d(coordinate),
      { ignore: [], toleranceMeters: this.getSnapTolerance(props) },
    );
  }

  getSnapAwareEvent<T extends ClickEvent | PointerMoveEvent>(
    event: T,
    props: ModeProps<FeatureCollection>,
  ): { event: T; snapTarget: LineStringEndpointRef | null } {
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
        !findNearestLineStringEndpoint([snapTarget], firstCoordinate, {
          ignore: [],
          toleranceMeters: this.getSnapTolerance(props),
        })
      ) {
        this.addClickSequence(snapAwareEvent);
        this.finishDrawing(props);
        return;
      }
    }

    super.handleClick(snapAwareEvent, props);
  }

  handlePointerMove(event: PointerMoveEvent, props: any) {
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
