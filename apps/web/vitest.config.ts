import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
    // Each editor fixture renders a full 21×21 map. Bound concurrent jsdom
    // environments so the normal test command does not exhaust CPU / memory.
    maxWorkers: 2,
  },
});
