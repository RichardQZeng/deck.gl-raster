import type { Feature, FeatureCollection, LineString } from "geojson";
import type { Coordinate2d } from "@deck.gl-community/editable-layers/line-network";

export type AnyFeatureCollection = FeatureCollection;
export type EditableFeatureCollection = FeatureCollection<LineString>;
export type EditableFeature = Feature<LineString>;

export type EditableEditContext = {
  featureIndexes?: number[];
  positionIndexes?: number[];
  position?: Coordinate2d;
};

export type EditableEditAction = {
  updatedData: AnyFeatureCollection;
  editType: string;
  editContext?: EditableEditContext;
};

export type EndpointMarker = {
  coordinate: Coordinate2d;
  count: number;
};

export type CaptureLine = {
  featureIndex: number;
  featureId: string | null;
  path: Coordinate2d[];
};

export type LoadedCenterlines = {
  data: EditableFeatureCollection;
  strippedZ: boolean;
};

export type SaveCenterlinesPayload = {
  featureCollection: EditableFeatureCollection;
  metadata: {
    rasterUrl?: string;
    crs?: "EPSG:4326";
    runId?: string;
    notes?: string;
  };
};

export type EditModeKey = "view" | "modify" | "deleteVertex" | "drawLine";
