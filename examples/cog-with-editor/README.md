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
- Switch modes: view, edit vertices, draw line
- Select a feature
- Delete selected feature
- Export edited features as `edited-lines.geojson`

## Data assumptions

- Seed data lives in `src/data/initial-lines.ts`
- Coordinates are WGS84 lon/lat (`EPSG:4326`)

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
- No snapping
- No polygon editing
- No topology validation
- No large-vector tiling workflow
