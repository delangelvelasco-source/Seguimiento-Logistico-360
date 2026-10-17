import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";

export default defineConfig({
  plugins: [
    react(),
    legacy({
      // Compatibility fallback for older embedded browsers (including older TV browsers).
      targets: ["Chrome >= 47", "Safari >= 10.1"],
      modernPolyfills: true,
      renderLegacyChunks: true
    })
  ],
  base: "./"
});