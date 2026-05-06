import type { Coordinate2d, LineStringEndpointRef } from "./types.js";

export function distanceMeters(a: Coordinate2d, b: Coordinate2d) {
  const metersPerDegreeLatitude = 111_320;
  const averageLatitudeRadians = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const metersPerDegreeLongitude =
    metersPerDegreeLatitude * Math.cos(averageLatitudeRadians);
  const dx = (a[0] - b[0]) * metersPerDegreeLongitude;
  const dy = (a[1] - b[1]) * metersPerDegreeLatitude;
  return Math.sqrt(dx * dx + dy * dy);
}

export function coordinatesWithinTolerance(
  a: Coordinate2d,
  b: Coordinate2d,
  toleranceMeters: number,
) {
  return distanceMeters(a, b) <= toleranceMeters;
}

export function isSameEndpoint(
  a: LineStringEndpointRef,
  b: LineStringEndpointRef,
) {
  return (
    a.featureIndex === b.featureIndex && a.coordinateIndex === b.coordinateIndex
  );
}

export function findNearestLineStringEndpoint(
  endpoints: LineStringEndpointRef[],
  coordinate: Coordinate2d,
  options: {
    ignore?: LineStringEndpointRef[];
    toleranceMeters: number;
  },
) {
  let nearest: LineStringEndpointRef | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const endpoint of endpoints) {
    if (options.ignore?.some((ignored) => isSameEndpoint(ignored, endpoint))) {
      continue;
    }

    const distance = distanceMeters(endpoint.coordinate, coordinate);
    if (distance <= options.toleranceMeters && distance < nearestDistance) {
      nearest = endpoint;
      nearestDistance = distance;
    }
  }

  return nearest;
}
