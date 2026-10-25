import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.endsWith("/game/catalogSearchIndex.json"))
            return "catalog-search";
          if (id.includes("/internal/catalog/definitions.json"))
            return "game-catalog";
          if (
            id.includes("/assets/items/v3/") ||
            id.endsWith("/game/itemSprites.ts")
          )
            return "item-sprites";
          if (
            id.includes("/assets/buildings/v1/") ||
            id.endsWith("/game/buildingArtwork.ts")
          )
            return "building-art";
          if (id.endsWith("/game/routeGeometry.ts")) return "route-geometry";
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/health": process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8080",
      "/api": process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8080",
    },
  },
});
