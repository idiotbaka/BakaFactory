import { build } from "vite";
await build({
  configFile: false,
  build: {
    ssr: "apps/web/src/game/local/benchmark.ts",
    outDir: "dist/benchmark",
    emptyOutDir: false,
    rollupOptions: { output: { entryFileNames: "simulation-benchmark.mjs" } },
  },
});
