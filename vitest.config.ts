import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    fileParallelism: false,
    env: { AUTH_SECRET: "vitest-secret-vitest-secret-0123456789" },
    environment: "node",
    exclude: ["e2e/**", "node_modules/**"],
  },
});
