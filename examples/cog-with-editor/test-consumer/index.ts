import {
  LineStringNetworkDrawMode,
  LineStringNetworkModifyMode,
  findNearestLineStringEndpoint,
  getConnectedLineStringEndpoints,
  getLineStringEndpointRefs,
  moveLineStringEndpointGroup,
  setLineStringEndpointCoordinate,
  toCoordinate2d,
  type LineStringEndpointRef,
  type LineStringFeatureCollection,
  type LineStringNetworkDrawModeConfig,
  type LineStringNetworkModifyModeConfig,
  type LineStringNetworkModeConfig,
} from "../src/editing/line-network/index.js";

const data: LineStringFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: "line-1" },
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    },
  ],
};

const endpointRefs = getLineStringEndpointRefs(data);
const firstEndpoint: LineStringEndpointRef = endpointRefs[0]!;
const movedSingle = setLineStringEndpointCoordinate(data, firstEndpoint, [2, 2]);
const connectedGroup = getConnectedLineStringEndpoints(data, firstEndpoint, {
  toleranceMeters: 5,
});
const movedGroup = moveLineStringEndpointGroup(data, connectedGroup, [3, 3]);
const nearest = findNearestLineStringEndpoint(endpointRefs, [0, 0], {
  ignore: [],
  toleranceMeters: 5,
});
const coord = toCoordinate2d([4, 4, 9]);

const drawModeClass = LineStringNetworkDrawMode;
const modifyModeClass = LineStringNetworkModifyMode;

const drawModeConfig: LineStringNetworkDrawModeConfig = {
  snapTargets: endpointRefs,
  snapTolerance: 5,
};

const modifyModeConfig: LineStringNetworkModifyModeConfig = {
  snapTolerance: 5,
  moveConnectedEndpoints: true,
};

const genericModeConfig: LineStringNetworkModeConfig = {
  snapTolerance: 5,
  moveConnectedEndpoints: true,
  finishDrawOnSnap: true,
  preventZeroLengthDraw: true,
};

void movedSingle;
void movedGroup;
void nearest;
void coord;
void drawModeClass;
void modifyModeClass;
void drawModeConfig;
void modifyModeConfig;
void genericModeConfig;
