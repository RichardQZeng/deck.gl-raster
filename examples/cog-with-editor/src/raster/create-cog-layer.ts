import { COGLayer } from "@developmentseed/deck.gl-geotiff";

type GeographicBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export function createCogLayer({
  geotiff,
  onGeographicBoundsLoad,
}: {
  geotiff: string;
  onGeographicBoundsLoad: (bounds: GeographicBounds) => void;
}) {
  return new COGLayer({
    id: "raster-layer",
    geotiff,
    onGeoTIFFLoad: (
      _tiff: unknown,
      options: { geographicBounds: GeographicBounds },
    ) => {
      onGeographicBoundsLoad(options.geographicBounds);
    },
  });
}
