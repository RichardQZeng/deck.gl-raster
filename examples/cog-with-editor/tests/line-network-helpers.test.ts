import { describe, expect, it } from "vitest";
import {
  findNearestLineStringEndpoint,
  getConnectedLineStringEndpoints,
  getLineStringEndpointRefs,
  moveLineStringEndpointGroup,
  setLineStringEndpointCoordinate,
} from "../src/editing/line-network/index.js";
import type { LineStringFeatureCollection } from "../src/editing/line-network/index.js";

const sampleData: LineStringFeatureCollection = {
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

describe("getLineStringEndpointRefs", () => {
  it("returns line start and end refs in feature order", () => {
    const refs = getLineStringEndpointRefs(sampleData);

    expect(refs).toEqual([
      { featureIndex: 0, coordinateIndex: 0, coordinate: [0, 0] },
      { featureIndex: 0, coordinateIndex: 1, coordinate: [1, 1] },
      { featureIndex: 1, coordinateIndex: 0, coordinate: [0, 0] },
      { featureIndex: 1, coordinateIndex: 1, coordinate: [2, 2] },
    ]);
  });

  it("treats nullish input as empty", () => {
    expect(getLineStringEndpointRefs(undefined)).toEqual([]);
    expect(getLineStringEndpointRefs(null)).toEqual([]);
  });
});

describe("getConnectedLineStringEndpoints", () => {
  it("groups coincident endpoints within tolerance", () => {
    const refs = getLineStringEndpointRefs(sampleData);
    const group = getConnectedLineStringEndpoints(sampleData, refs[0]!, {
      toleranceMeters: 5,
    });

    expect(group.representativeCoordinate).toEqual([0, 0]);
    expect(group.endpoints).toHaveLength(2);
    expect(group.endpoints.map((endpoint) => endpoint.featureIndex)).toEqual([0, 1]);
  });
});

describe("findNearestLineStringEndpoint", () => {
  it("returns the nearest endpoint within tolerance", () => {
    const refs = getLineStringEndpointRefs(sampleData);
    const nearest = findNearestLineStringEndpoint(refs, [0, 0], {
      ignore: [],
      toleranceMeters: 5,
    });

    expect(nearest).toEqual(refs[0]);
  });

  it("returns null when all candidates are ignored", () => {
    const refs = getLineStringEndpointRefs(sampleData);
    const nearest = findNearestLineStringEndpoint(refs, [0, 0], {
      ignore: [refs[0]!, refs[2]!],
      toleranceMeters: 5,
    });

    expect(nearest).toBeNull();
  });
});

describe("endpoint coordinate mutation helpers", () => {
  it("sets a single endpoint coordinate without touching other refs", () => {
    const refs = getLineStringEndpointRefs(sampleData);
    const updated = setLineStringEndpointCoordinate(sampleData, refs[1]!, [9, 9]);

    expect(updated.features[0]!.geometry.coordinates).toEqual([
      [0, 0],
      [9, 9],
    ]);
    expect(updated.features[1]!.geometry.coordinates).toEqual([
      [0, 0],
      [2, 2],
    ]);
  });

  it("moves all refs in a connected endpoint group together", () => {
    const refs = getLineStringEndpointRefs(sampleData);
    const group = getConnectedLineStringEndpoints(sampleData, refs[0]!, {
      toleranceMeters: 5,
    });
    const updated = moveLineStringEndpointGroup(sampleData, group, [5, 5]);

    expect(updated.features[0]!.geometry.coordinates[0]).toEqual([5, 5]);
    expect(updated.features[1]!.geometry.coordinates[0]).toEqual([5, 5]);
  });
});
