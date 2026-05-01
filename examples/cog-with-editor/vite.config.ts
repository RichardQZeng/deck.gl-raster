import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/deck.gl-raster/examples/cog-with-editor/",
  worker: { format: "es" },
  server: {
    port: 3000,
  },
});
