import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/internal/catalog/definitions.json"))
            return "game-catalog";
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
