import type { FeatureCollection, LineString } from "geojson";

export const INITIAL_LINES: FeatureCollection<LineString> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        id: "test-line-1",
        name: "editable centerline",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-114.1, 51.05],
          [-114.09, 51.051],
          [-114.08, 51.052],
        ],
      },
    },
  ],
};
