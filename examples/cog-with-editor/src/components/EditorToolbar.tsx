import type { EditModeKey } from "../types.js";

export function EditorToolbar({
  mode,
  selectedFeatureLabel,
  featureCount,
  importStatus,
  canDeleteSelected,
  onModeChange,
  onLoadGeoPackage,
  onDeleteSelected,
  onSaveGeoJson,
}: {
  mode: EditModeKey;
  selectedFeatureLabel: number | "none";
  featureCount: number;
  importStatus: string;
  canDeleteSelected: boolean;
  onModeChange: (mode: EditModeKey) => void;
  onLoadGeoPackage: () => void;
  onDeleteSelected: () => void;
  onSaveGeoJson: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: "20px",
        left: "20px",
        zIndex: 1000,
        background: "rgba(255, 255, 255, 0.95)",
        border: "1px solid #d7dde3",
        borderRadius: "10px",
        boxShadow: "0 8px 22px rgba(0, 0, 0, 0.16)",
        padding: "12px",
        width: "360px",
      }}
    >
      <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "10px" }}>
        COG + Line Editor Prototype
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button type="button" onClick={() => onModeChange("view")}>
          View
        </button>
        <button type="button" onClick={() => onModeChange("modify")}>
          Move Vertex
        </button>
        <button type="button" onClick={() => onModeChange("deleteVertex")}>
          Delete Vertex
        </button>
        <button type="button" onClick={() => onModeChange("drawLine")}>
          Draw Line
        </button>
        <button type="button" onClick={onLoadGeoPackage}>
          Load GPKG
        </button>
        <button type="button" onClick={onDeleteSelected} disabled={!canDeleteSelected}>
          Delete Selected
        </button>
        <button type="button" onClick={onSaveGeoJson}>
          Save GeoJSON
        </button>
      </div>

      <div
        style={{
          marginTop: "10px",
          paddingTop: "10px",
          borderTop: "1px solid #e8edf2",
          fontSize: "13px",
          color: "#37414b",
          lineHeight: 1.45,
        }}
      >
        <div>Selected feature: {selectedFeatureLabel}</div>
        <div>Feature count: {featureCount}</div>
        <div>Current mode: {mode}</div>
        <div>GPKG status: {importStatus}</div>
      </div>
    </div>
  );
}
