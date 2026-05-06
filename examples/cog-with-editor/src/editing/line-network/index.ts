export {
  getConnectedLineStringEndpoints,
  getLineStringEndpointRefs,
  moveLineStringEndpointGroup,
  setLineStringEndpointCoordinate,
  toCoordinate2d,
} from "./endpoints.js";
export { findNearestLineStringEndpoint } from "./snapping.js";
export type {
  Coordinate2d,
  LineStringEndpointGroup,
  LineStringEndpointRef,
  LineStringFeature,
  LineStringFeatureCollection,
  LineStringNetworkModeConfig,
} from "./types.js";
