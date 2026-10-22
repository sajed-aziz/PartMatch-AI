import { defineConfig } from "vitest/config";
import path from "node:path";

// Explicit opt-in: ordinary npm test never starts live inference.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    include: ["tests/ai-authorized-photos.live.ts"],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 140_000,
    hookTimeout: 20_000,
  },
});
