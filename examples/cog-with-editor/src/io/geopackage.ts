import sqlWasmUrl from "@ngageoint/geopackage/dist/sql-wasm.wasm?url";
import type { GeoJsonProperties, Position } from "geojson";
import proj4 from "proj4";
import {
  CENTERLINE_TABLE_NAME,
  TEST_GPKG_SRS,
  WGS84,
} from "../constants.js";
import {
  toCoordinate2d,
  type Coordinate2d,
} from "@deck.gl-community/editable-layers/line-network";
import type { EditableFeature, LoadedCenterlines } from "../types.js";

proj4.defs(
  "EPSG:2956",
  "+proj=utm +zone=12 +ellps=GRS80 +datum=NAD83 +units=m +no_defs +type=crs",
);

function transformCoordinate(position: Position, srsId: number) {
  if (srsId === 4326) {
    return toCoordinate2d(position);
  }

  const [longitude, latitude] = proj4(TEST_GPKG_SRS, WGS84, [
    position[0],
    position[1],
  ]);
  return [longitude, latitude] as Coordinate2d;
}

function transformLineString(coordinates: Position[], srsId: number) {
  let strippedZ = false;
  const transformedCoordinates = coordinates.map((coordinate) => {
    if (coordinate.length > 2) {
      strippedZ = true;
    }
    return transformCoordinate(coordinate, srsId);
  });

  return { coordinates: transformedCoordinates, strippedZ };
}

function getLineStringsFromGeoJson(geoJson: any): Position[][] {
  if (!geoJson) {
    return [];
  }

  if (geoJson.type === "Feature") {
    return getLineStringsFromGeoJson(geoJson.geometry);
  }

  if (geoJson.type === "LineString") {
    return [geoJson.coordinates];
  }

  if (geoJson.type === "MultiLineString") {
    return geoJson.coordinates;
  }

  return [];
}

function getFeatureProperties(
  feature: any,
  fallbackId: string,
  rowProperties: GeoJsonProperties = {},
): GeoJsonProperties {
  const featureProperties =
    feature.type === "Feature" ? feature.properties : undefined;
  const properties: NonNullable<GeoJsonProperties> = {
    ...rowProperties,
    ...(featureProperties ?? {}),
  };
  properties.id =
    typeof properties.id === "string" ? properties.id : fallbackId;
  return properties;
}

function getRowProperties(featureRow: {
  columnNames: string[];
  geometryColumn: { name: string };
  getValueWithColumnName: (columnName: string) => unknown;
}) {
  const properties: GeoJsonProperties = {};

  for (const columnName of featureRow.columnNames) {
    if (columnName === featureRow.geometryColumn.name) {
      continue;
    }

    const value = featureRow.getValueWithColumnName(columnName);
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      properties[columnName] = value;
    }
  }

  return properties;
}

export async function loadCenterlineTable(
  file: File,
): Promise<LoadedCenterlines> {
  const { GeoPackageAPI, setSqljsWasmLocateFile } = await import(
    "@ngageoint/geopackage"
  );
  setSqljsWasmLocateFile(() => sqlWasmUrl);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const geoPackage = await GeoPackageAPI.open(bytes);

  try {
    if (!geoPackage.hasFeatureTable(CENTERLINE_TABLE_NAME)) {
      throw new Error("GPKG is missing centerline table");
    }

    const featureDao = geoPackage.getFeatureDao(CENTERLINE_TABLE_NAME);
    const srsId = featureDao.srs.srs_id;

    if (srsId !== 4326 && srsId !== 2956) {
      throw new Error(`Unsupported CRS: EPSG:${srsId}`);
    }

    const features: EditableFeature[] = [];
    let strippedZ = false;

    for (const rowValues of featureDao.queryForAll()) {
      const featureRow = featureDao.createObject(rowValues);
      const rawFeature = featureRow.geometry.toGeoJSON();
      const rowProperties = getRowProperties(featureRow);
      const lineStrings = getLineStringsFromGeoJson(rawFeature);

      lineStrings.forEach((coordinates, lineStringIndex) => {
        const transformed = transformLineString(coordinates, srsId);
        strippedZ = strippedZ || transformed.strippedZ;

        features.push({
          type: "Feature",
          properties: getFeatureProperties(
            rawFeature,
            `gpkg-${featureRow.id}${lineStrings.length > 1 ? `-${lineStringIndex}` : ""}`,
            rowProperties,
          ),
          geometry: {
            type: "LineString",
            coordinates: transformed.coordinates,
          },
        });
      });
    }

    if (features.length === 0) {
      throw new Error("No LineString features found in centerline");
    }

    return {
      data: {
        type: "FeatureCollection",
        features,
      },
      strippedZ,
    };
  } finally {
    geoPackage.close();
  }
}
