import type { Feature, FeatureCollection, LineString, Position } from "geojson";

export type Coordinate2d = [number, number];
export type LineStringFeatureCollection = FeatureCollection<LineString>;
export type LineStringFeature = Feature<LineString>;

export type LineStringEndpointRef = {
  featureIndex: number;
  coordinateIndex: number;
  coordinate: Coordinate2d;
};

export type LineStringEndpointGroup = {
  representativeCoordinate: Position;
  endpoints: LineStringEndpointRef[];
};

export type LineStringNetworkModeConfig = {
  snapTolerance?: number;
  moveConnectedEndpoints?: boolean;
  finishDrawOnSnap?: boolean;
  preventZeroLengthDraw?: boolean;
  getSnapCandidates?: (data: FeatureCollection) => Feature<LineString>[];
};
