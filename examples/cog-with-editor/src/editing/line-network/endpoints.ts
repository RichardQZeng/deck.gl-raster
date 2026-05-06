import type { Position } from "geojson";
import type {
  Coordinate2d,
  LineStringEndpointGroup,
  LineStringEndpointRef,
  LineStringFeatureCollection,
} from "./types.js";
import { coordinatesWithinTolerance } from "./snapping.js";

export function toCoordinate2d(position: Position): Coordinate2d {
  return [position[0], position[1]];
}

export function getLineStringEndpointRefs(
  featureCollection: LineStringFeatureCollection | null | undefined,
): LineStringEndpointRef[] {
  const endpoints: LineStringEndpointRef[] = [];

  featureCollection?.features.forEach((feature, featureIndex) => {
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

export function getConnectedLineStringEndpoints(
  featureCollection: LineStringFeatureCollection | null | undefined,
  endpoint: LineStringEndpointRef,
  { toleranceMeters }: { toleranceMeters: number },
): LineStringEndpointGroup {
  const endpoints = getLineStringEndpointRefs(featureCollection).filter(
    (candidate) =>
      coordinatesWithinTolerance(candidate.coordinate, endpoint.coordinate, toleranceMeters),
  );

  return {
    representativeCoordinate: endpoints[0]?.coordinate ?? endpoint.coordinate,
    endpoints,
  };
}

export function setLineStringEndpointCoordinate(
  featureCollection: LineStringFeatureCollection,
  endpoint: LineStringEndpointRef,
  coordinate: Coordinate2d,
): LineStringFeatureCollection {
  return moveLineStringEndpointGroup(
    featureCollection,
    { representativeCoordinate: endpoint.coordinate, endpoints: [endpoint] },
    coordinate,
  );
}

export function moveLineStringEndpointGroup(
  featureCollection: LineStringFeatureCollection,
  group: LineStringEndpointGroup,
  coordinate: Coordinate2d,
): LineStringFeatureCollection {
  if (group.endpoints.length === 0) {
    return featureCollection;
  }

  const endpointsByFeature = new Map<number, LineStringEndpointRef[]>();
  for (const endpoint of group.endpoints) {
    const featureEndpoints = endpointsByFeature.get(endpoint.featureIndex) ?? [];
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
