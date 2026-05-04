# COG With Editor Example

This example demonstrates a raster + vector editing prototype using:

- `COGLayer` from `@developmentseed/deck.gl-geotiff`
- `EditableGeoJsonLayer` from `@deck.gl-community/editable-layers`

The app is intentionally minimal and keeps editing logic in the example layer instead of raster core packages.

## Run

1. Install dependencies from the repository root:

   ```bash
   pnpm install
   ```

2. Start the example:

   ```bash
   cd examples/cog-with-editor
   pnpm dev
   ```

3. Open http://localhost:3000

## Current capabilities

- View a NAIP COG raster
- Show editable line GeoJSON above raster
- Load editable `centerline` LineStrings from a local GeoPackage file
- Switch modes: view, edit vertices, draw line
- Select a feature
- Delete selected feature
- Export edited features as `edited-lines.geojson`
- Endpoint snapping: line start/end vertices snap to nearby line endpoints
- Shared endpoint movement: colocated line endpoints move together

## Data assumptions

- Seed data lives in `src/data/initial-lines.ts`
- Coordinates are WGS84 lon/lat (`EPSG:4326`)
- Local GeoPackage imports read only the `centerline` feature table
- Imported GeoPackage data is supported when `centerline` is `EPSG:4326` or `EPSG:2956`
- `EPSG:2956` centerlines, such as `agents/test.gpkg`, are reprojected to WGS84 for editing
- Z coordinates are stripped on import because the editor stores edited positions as 2D lon/lat

## Import status messages

- `No GPKG loaded`
- `Loading centerline...`
- `Loaded centerline: <n> features`
- `Loaded centerline: <n> features; stripped Z coordinates`
- `GPKG is missing centerline table`
- `Unsupported CRS: EPSG:<id>`
- `No LineString features found in centerline`

## Future extension point

A stubbed `saveToBackend()` function is included in `src/App.tsx` for later FastAPI integration.

Target payload shape:

```ts
type SaveCenterlinesPayload = {
  featureCollection: GeoJSON.FeatureCollection;
  metadata: {
    rasterUrl?: string;
    crs?: 'EPSG:4326';
    runId?: string;
    notes?: string;
  };
};
```

## Limitations

- Prototype only; no backend save wiring in UI
- GeoJSON export only; no GeoPackage writeback
- Endpoint topology only; mid-line vertices are editable but not topologically linked
- No polygon editing
- No topology validation
- No large-vector tiling workflow
