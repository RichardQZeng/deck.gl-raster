import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo, useRef } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import { EditorToolbar } from "./EditorToolbar.js";
import { DEFAULT_COG_URL } from "../constants.js";
import { useEditableLines } from "../editing/app/use-editable-lines.js";
import { DeckGLOverlay } from "../map/DeckGLOverlay.js";
import { createCogLayer } from "../raster/create-cog-layer.js";
import type { SaveCenterlinesPayload } from "../types.js";

export async function saveToBackend(
  payload: SaveCenterlinesPayload,
): Promise<void> {
  void payload;
  throw new Error("Backend save is not implemented in this prototype.");
}

export function CogLineEditorMap() {
  const mapRef = useRef<MapRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editor = useEditableLines({ mapRef, fileInputRef });

  const cogLayer = useMemo(
    () =>
      createCogLayer({
        geotiff: DEFAULT_COG_URL,
        onGeographicBoundsLoad: editor.handleCogGeographicBoundsLoad,
      }),
    [editor.handleCogGeographicBoundsLoad],
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: -114.09,
          latitude: 51.051,
          zoom: 10,
          pitch: 0,
          bearing: 0,
        }}
        doubleClickZoom={false}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
      >
        <DeckGLOverlay
          layers={[
            cogLayer,
            editor.captureLineLayer,
            editor.editableLayer,
            editor.endpointMarkerLayer,
          ]}
          interleaved
          onHover={editor.handleOverlayHover}
        />
      </MaplibreMap>

      <input
        ref={fileInputRef}
        type="file"
        accept=".gpkg,application/geopackage+sqlite3,application/octet-stream"
        onChange={editor.handleGeoPackageFileChange}
        style={{ display: "none" }}
      />

      <EditorToolbar
        mode={editor.mode}
        selectedFeatureLabel={editor.selectedFeatureLabel}
        featureCount={editor.editableData.features.length}
        importStatus={editor.importStatus}
        canDeleteSelected={editor.selectedFeatureIndexes.length > 0}
        onModeChange={editor.setMode}
        onLoadGeoPackage={editor.handleLoadGeoPackage}
        onDeleteSelected={editor.handleDeleteSelected}
        onSaveGeoJson={editor.handleSaveGeoJson}
      />
    </div>
  );
}
