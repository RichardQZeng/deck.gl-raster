import { describe, expect, it, vi } from "vitest";
import type {
  ClickEvent,
  ModeProps,
  Pick,
  PointerMoveEvent,
  StartDraggingEvent,
  StopDraggingEvent,
} from "@deck.gl-community/editable-layers";
import {
  LineStringNetworkDrawMode,
  LineStringNetworkModifyMode,
  type LineStringFeatureCollection,
} from "../src/editing/line-network/index.js";

function createClickEvent(
  mapCoords: [number, number],
  picks: Pick[] = [],
  sourceEvent: any = null,
): ClickEvent {
  return {
    screenCoords: [-1, -1],
    mapCoords,
    picks,
    sourceEvent,
  };
}

function createPointerMoveEvent(
  mapCoords: [number, number],
  picks: Pick[] = [],
): PointerMoveEvent {
  return {
    screenCoords: [-1, -1],
    mapCoords,
    picks,
    pointerDownPicks: null,
    pointerDownScreenCoords: null,
    pointerDownMapCoords: null,
    cancelPan: vi.fn(),
    sourceEvent: null,
  };
}

function createStartDraggingEvent(
  mapCoords: [number, number],
  pointerDownMapCoords: [number, number],
  picks: Pick[] = [],
): StartDraggingEvent {
  return {
    screenCoords: [-1, -1],
    mapCoords,
    picks,
    pointerDownPicks: null,
    pointerDownScreenCoords: [-1, -1],
    pointerDownMapCoords,
    cancelPan: vi.fn(),
    sourceEvent: null,
  };
}

function createStopDraggingEvent(
  mapCoords: [number, number],
  pointerDownMapCoords: [number, number],
  picks: Pick[] = [],
  pointerDownPicks: Pick[] | null = null,
): StopDraggingEvent {
  return {
    screenCoords: [-1, -1],
    mapCoords,
    picks,
    pointerDownPicks,
    pointerDownScreenCoords: [-1, -1],
    pointerDownMapCoords,
    sourceEvent: null,
  };
}

function createFeatureCollectionProps(
  overrides: Partial<ModeProps<LineStringFeatureCollection>> = {},
): ModeProps<LineStringFeatureCollection> {
  return {
    data: {
      type: "FeatureCollection",
      features: [],
    },
    selectedIndexes: [],
    lastPointerMoveEvent: createPointerMoveEvent([0, 0]),
    modeConfig: null,
    onEdit: vi.fn(),
    onUpdateCursor: vi.fn(),
    ...overrides,
  };
}

describe("LineStringNetworkDrawMode", () => {
  it("right-click finishes the line without adding the floating endpoint", () => {
    const mode = new LineStringNetworkDrawMode();
    const props = createFeatureCollectionProps({
      data: {
        type: "FeatureCollection",
        features: [],
      },
    });

    mode.handleClick(createClickEvent([0, 0]), props as any);
    mode.handleClick(createClickEvent([1, 1]), props as any);
    mode.handleClick(
      createClickEvent([9, 9], [], {
        button: 2,
        preventDefault: vi.fn(),
      }),
      props as any,
    );

    const onEdit = props.onEdit as ReturnType<typeof vi.fn>;
    expect(onEdit).toHaveBeenCalledTimes(3);
    expect(onEdit.mock.calls[2][0].editType).toBe("addFeature");
    expect(onEdit.mock.calls[2][0].updatedData.features[0].geometry.coordinates).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});

describe("LineStringNetworkModifyMode", () => {
  it("moves connected endpoints together on drag finish", () => {
    const data: LineStringFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: "a" },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
        {
          type: "Feature",
          properties: { id: "b" },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [2, 2],
            ],
          },
        },
      ],
    };

    const mode = new LineStringNetworkModifyMode();
    const onEdit = vi.fn();
    const props = createFeatureCollectionProps({
      data,
      selectedIndexes: [0],
      modeConfig: { snapTolerance: 5, moveConnectedEndpoints: true },
      onEdit,
    });

    const guides = mode.getGuides(props as any);
    const firstHandle = guides.features.find(
      (feature) => feature.properties.editHandleType === "existing",
    );
    expect(firstHandle).toBeTruthy();

    const picks: Pick[] = [{
      index: 0,
      isGuide: true,
      object: firstHandle,
    }];

    mode.handlePointerMove(createPointerMoveEvent([0, 0], picks), props as any);
    mode.handleStartDragging(
      createStartDraggingEvent([0, 0], [0, 0], picks),
      props as any,
    );
    mode.handleStopDragging(
      createStopDraggingEvent([5, 5], [0, 0], picks, picks),
      props as any,
    );

    const finalEdit = onEdit.mock.calls.at(-1)?.[0];
    expect(finalEdit.editType).toBe("finishMovePosition");
    expect(finalEdit.updatedData.features[0].geometry.coordinates[0]).toEqual([5, 5]);
    expect(finalEdit.updatedData.features[1].geometry.coordinates[0]).toEqual([5, 5]);
  });
});
