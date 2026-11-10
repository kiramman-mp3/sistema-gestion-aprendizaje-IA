import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Los contratos se prueban desde su código fuente, sin compilarlos antes.
    alias: {
      "@smart-lms/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url),
      ),
    },
  },
  test: { include: ["tests/**/*.test.mjs"] },
});
